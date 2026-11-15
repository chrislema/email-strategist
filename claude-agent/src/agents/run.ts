import path from "node:path";
import { query, type HookCallback, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { z } from "zod";
import { AGENT_ROOT, config, REVIEW_SKILL_DIR } from "../config.ts";
import { jsonSchemaOf } from "../schema.ts";
import { tokensFromModelUsage, usageLine, type CallUsage, type ToolStat, type TurnStat } from "../usage.ts";

export type AgentRun<T> = { output: T; costUsd: number; turns: number; sessionId: string; usage: CallUsage };
/** Called once per agent call with its usage, before the output is validated, so failed calls are counted too. */
export type UsageSink = (usage: CallUsage) => void;

/** Size of a tool_result's content: text characters and image count. */
function resultSize(content: unknown): { chars: number; images: number } {
  if (typeof content === "string") return { chars: content.length, images: 0 };
  let chars = 0;
  let images = 0;
  if (Array.isArray(content))
    for (const b of content as { type?: string; text?: string }[]) {
      if (b?.type === "image") images++;
      else if (typeof b?.text === "string") chars += b.text.length;
      else chars += JSON.stringify(b ?? "").length;
    }
  return { chars, images };
}

const READ_ONLY_TOOLS = ["Read", "Glob", "Grep"];

/** Deny any attempt to open a path (used to keep the grader's rubric away from the writer). */
function denyPaths(fragments: string[]): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const s = JSON.stringify(input.tool_input ?? {});
    const hit = fragments.find((f) => s.includes(f));
    if (!hit) return {};
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "That file belongs to the reviewer. Write to the brief and the brand guide, not to the rubric.",
      },
    };
  };
}

export async function runAgent<S extends z.ZodType>(args: {
  label: string;
  prompt: string;
  schema: S;
  model: string;
  effort: Options["effort"];
  skills: string[];
  extraDirs: string[];
  hideReviewRubric?: boolean;
  system: string;
  onUsage?: UsageSink;
}): Promise<AgentRun<z.infer<S>>> {
  const log = (msg: string) => process.stderr.write(`  [${args.label}] ${msg}\n`);
  const q = query({
    prompt: args.prompt,
    options: {
      cwd: AGENT_ROOT,
      additionalDirectories: args.extraDirs,
      // Project settings only: loads ./.claude/skills, and keeps the user's personal hooks/plugins out of the run.
      settingSources: ["project"],
      skills: args.skills,
      tools: READ_ONLY_TOOLS,
      allowedTools: READ_ONLY_TOOLS,
      permissionMode: "dontAsk",
      model: args.model,
      effort: args.effort,
      thinking: { type: "adaptive" },
      maxTurns: config.maxTurnsPerCall,
      maxBudgetUsd: config.budgetPerCallUsd,
      persistSession: false,
      outputFormat: { type: "json_schema", schema: jsonSchemaOf(args.schema) },
      systemPrompt: { type: "preset", preset: "claude_code", append: args.system },
      hooks: args.hideReviewRubric
        ? { PreToolUse: [{ hooks: [denyPaths([path.join(".claude", "skills", REVIEW_SKILL_DIR), REVIEW_SKILL_DIR])] }] }
        : undefined,
    },
  });

  // Per-turn usage, keyed by API message id (the SDK can split one response into several assistant messages).
  const turns = new Map<string, TurnStat>();
  const toolNameById = new Map<string, string>();
  const tools: Record<string, ToolStat> = {};

  for await (const m of q) {
    if (m.type === "assistant") {
      const msg = m.message;
      const turn = turns.get(msg.id) ?? { turn: turns.size + 1, tools: [], input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
      const u = msg.usage;
      if (u) {
        turn.input = u.input_tokens ?? 0;
        turn.cacheRead = u.cache_read_input_tokens ?? 0;
        turn.cacheWrite = u.cache_creation_input_tokens ?? 0;
        turn.output = Math.max(turn.output, u.output_tokens ?? 0);
      }
      for (const block of msg.content) {
        if (block.type === "tool_use") {
          const input = block.input as Record<string, unknown>;
          const target = (input.file_path ?? input.pattern ?? input.skill ?? input.path ?? "") as string;
          const desc = `${block.name} ${path.basename(String(target))}`.trim();
          toolNameById.set(block.id, block.name);
          (tools[block.name] ??= { calls: 0, resultChars: 0, images: 0 }).calls++;
          turn.tools.push(desc);
          if (block.name !== "StructuredOutput") log(desc);
        }
      }
      turns.set(msg.id, turn);
    }
    if (m.type === "user" && Array.isArray(m.message.content)) {
      for (const block of m.message.content as { type: string; tool_use_id?: string; content?: unknown }[]) {
        if (block.type !== "tool_result") continue;
        const name = toolNameById.get(block.tool_use_id ?? "") ?? "unknown";
        const size = resultSize(block.content);
        const stat = (tools[name] ??= { calls: 0, resultChars: 0, images: 0 });
        stat.resultChars += size.chars;
        stat.images += size.images;
      }
    }
    if (m.type === "result") {
      const ok = m.subtype === "success" && !m.is_error;
      const usage: CallUsage = {
        label: args.label,
        model: args.model,
        ok,
        turns: m.num_turns,
        durationMs: m.duration_ms,
        apiMs: m.duration_api_ms,
        costUsd: m.total_cost_usd,
        tokens: tokensFromModelUsage(m.modelUsage ?? {}),
        byModel: m.modelUsage ?? {},
        tools,
        perTurn: [...turns.values()],
      };
      args.onUsage?.(usage);
      log(`${ok ? "done" : "failed"} · ${usageLine(usage)}`);
      if (!ok) {
        const detail = "errors" in m ? m.errors.join("; ") : m.result;
        throw new Error(`${args.label} stopped: ${m.subtype}${detail ? ` (${detail})` : ""}`);
      }
      const parsed = args.schema.safeParse(m.structured_output);
      if (!parsed.success) throw new Error(`${args.label} returned output that doesn't match the schema: ${parsed.error.message.slice(0, 800)}`);
      return { output: parsed.data, costUsd: m.total_cost_usd, turns: m.num_turns, sessionId: m.session_id, usage };
    }
  }
  throw new Error(`${args.label} ended without a result.`);
}
