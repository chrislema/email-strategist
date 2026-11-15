import path from "node:path";
import { query, type HookCallback, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { z } from "zod";
import { AGENT_ROOT, config, REVIEW_SKILL_DIR } from "../config.ts";
import { jsonSchemaOf } from "../schema.ts";

export type AgentRun<T> = { output: T; costUsd: number; turns: number; sessionId: string };

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

  for await (const m of q) {
    if (m.type === "assistant") {
      for (const block of m.message.content) {
        if (block.type === "tool_use") {
          const input = block.input as Record<string, unknown>;
          const target = (input.file_path ?? input.pattern ?? input.skill ?? input.path ?? "") as string;
          if (block.name !== "StructuredOutput") log(`${block.name} ${path.basename(String(target))}`.trim());
        }
      }
    }
    if (m.type === "result") {
      if (m.subtype !== "success" || m.is_error) {
        const detail = "errors" in m ? m.errors.join("; ") : m.result;
        throw new Error(`${args.label} stopped: ${m.subtype}${detail ? ` (${detail})` : ""}`);
      }
      const parsed = args.schema.safeParse(m.structured_output);
      if (!parsed.success) throw new Error(`${args.label} returned output that doesn't match the schema: ${parsed.error.message.slice(0, 800)}`);
      log(`done · ${m.num_turns} turns · ~$${m.total_cost_usd.toFixed(2)}`);
      return { output: parsed.data, costUsd: m.total_cost_usd, turns: m.num_turns, sessionId: m.session_id };
    }
  }
  throw new Error(`${args.label} ended without a result.`);
}
