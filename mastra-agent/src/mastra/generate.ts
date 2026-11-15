import type { Agent } from "@mastra/core/agent";
import type { z } from "zod";
import { config } from "../lib/config";
import { costOf, tokensFromMastra, usageLine, type CallUsage } from "../lib/usage";

const say = (msg: string) => process.stderr.write(`${msg}\n`);

/** Called once per agent call with its usage, before the output is validated, so failed calls are counted too. */
export type UsageSink = (usage: CallUsage) => void;
type Effort = "low" | "medium" | "high" | "xhigh" | "max";
type StepLike = { usage?: unknown; toolCalls?: { payload?: { toolName?: string; args?: unknown } }[] };

const toolDesc = (t: { payload?: { toolName?: string; args?: unknown } }) => {
  const name = t.payload?.toolName ?? "tool";
  const arg = (t.payload?.args as Record<string, unknown> | undefined)?.name as string | undefined;
  return arg ? `${name} ${arg}` : name;
};

export async function generateStructured<S extends z.ZodType>(
  agent: Agent,
  label: string,
  messages: Parameters<Agent["generate"]>[0],
  schema: S,
  model: string,
  effort: Effort,
  onUsage?: UsageSink,
): Promise<{ object: z.infer<S>; usage: CallUsage }> {
  say(`  [${label}] generating with ${model}…`);
  const started = Date.now();
  const res = await agent.generate(messages, {
    maxSteps: 12,
    // The campaign schema is too large for Anthropic's strict output grammar ("compiled grammar is too large"),
    // so the schema goes in the prompt and Mastra validates the reply against it.
    structuredOutput: { schema: schema as unknown as z.ZodObject<z.ZodRawShape>, jsonPromptInjection: true },
    modelSettings: { maxOutputTokens: config.maxOutputTokens },
    providerOptions: {
      anthropic: {
        thinking: { type: "adaptive" },
        effort,
        // Automatic caching: the breakpoint moves to the end of the conversation on every step, so each tool
        // round-trip re-reads the earlier steps from cache instead of paying full input price for them again.
        ...(config.cache ? { cacheControl: { type: "ephemeral" } } : {}),
      },
    },
    onStepFinish: (event) => {
      for (const t of event.toolCalls ?? []) say(`  [${label}] ${toolDesc(t)}`);
    },
  });

  // res.usage is the LAST step only; totalUsage covers every step of the call.
  const steps = (res.steps ?? []) as StepLike[];
  const tools: CallUsage["tools"] = {};
  const perStep = steps.map((s, i) => {
    for (const t of s.toolCalls ?? []) (tools[t.payload?.toolName ?? "tool"] ??= { calls: 0 }).calls++;
    const { input, cacheRead, cacheWrite, output } = tokensFromMastra(s.usage);
    return { step: i + 1, tools: (s.toolCalls ?? []).map(toolDesc), input, cacheRead, cacheWrite, output };
  });
  const tokens = tokensFromMastra(res.totalUsage ?? res.usage);
  const parsed = schema.safeParse(res.object);
  const usage: CallUsage = {
    label,
    model,
    ok: parsed.success,
    steps: Math.max(steps.length, 1),
    durationMs: Date.now() - started,
    costUsd: costOf(model, tokens),
    tokens,
    tools,
    perStep,
  };
  onUsage?.(usage);
  say(`  [${label}] ${parsed.success ? "done" : "failed"} · ${usageLine(usage)}`);
  if (!parsed.success) throw new Error(`${label} returned output that doesn't match the schema: ${parsed.error.message.slice(0, 800)}`);
  return { object: parsed.data, usage };
}
