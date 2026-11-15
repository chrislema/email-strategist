import type { ModelUsage } from "@anthropic-ai/claude-agent-sdk";

/** Token counts for one call or a whole run. `input` is uncached input only; cache reads and writes are separate. */
export type Tokens = { input: number; cacheRead: number; cacheWrite: number; cacheWrite1h: number; output: number; thinking: number };
/** What a tool cost in context: how often it ran and how much its results added (chars ≈ 4 per token). */
export type ToolStat = { calls: number; resultChars: number; images: number };
/** One API request inside an agent call. Approximate: read from the streamed assistant messages. */
export type TurnStat = { turn: number; tools: string[]; input: number; cacheRead: number; cacheWrite: number; output: number };

export type CallUsage = {
  label: string;
  model: string;
  ok: boolean;
  turns: number;
  durationMs: number;
  apiMs: number;
  /** The SDK's own estimate (prices cache reads/writes, covers every model call in the query). */
  costUsd: number;
  tokens: Tokens;
  byModel: Record<string, ModelUsage>;
  tools: Record<string, ToolStat>;
  perTurn: TurnStat[];
};

export type UsageReport = { totals: Tokens & { calls: number; turns: number; costUsd: number }; calls: CallUsage[] };

export const emptyTokens = (): Tokens => ({ input: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0, thinking: 0 });

/** Sum the SDK's per-model usage into one Tokens record. */
export function tokensFromModelUsage(byModel: Record<string, ModelUsage>): Tokens {
  const t = emptyTokens();
  for (const u of Object.values(byModel)) {
    t.input += u.inputTokens ?? 0;
    t.cacheRead += u.cacheReadInputTokens ?? 0;
    t.cacheWrite += u.cacheCreationInputTokens ?? 0;
    t.cacheWrite1h += u.cacheCreationEphemeral1hInputTokens ?? 0;
    t.output += u.outputTokens ?? 0;
    t.thinking += u.thinkingTokens ?? 0;
  }
  return t;
}

export function usageReport(calls: CallUsage[]): UsageReport {
  const totals = { ...emptyTokens(), calls: calls.length, turns: 0, costUsd: 0 };
  for (const c of calls) {
    for (const k of Object.keys(c.tokens) as (keyof Tokens)[]) totals[k] += c.tokens[k];
    totals.turns += c.turns;
    totals.costUsd += c.costUsd;
  }
  return { totals, calls };
}

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K` : String(n));

/** One log line per finished call. */
export const usageLine = (c: CallUsage) =>
  `${c.turns} turns · ${k(c.tokens.input)} in · ${k(c.tokens.cacheRead)} cache read · ${k(c.tokens.cacheWrite)} cache write · ${k(c.tokens.output)} out (${k(c.tokens.thinking)} thinking) · ~$${c.costUsd.toFixed(2)}`;

/** cost.md: per-call table, then which tools filled the context. */
export function renderCost(report: UsageReport): string {
  const { totals, calls } = report;
  const row = (label: string, turns: number, t: Tokens, cost: number) =>
    `| ${label} | ${turns} | ${k(t.input)} | ${k(t.cacheRead)} | ${k(t.cacheWrite)} | ${k(t.output)} | ${k(t.thinking)} | $${cost.toFixed(2)} |`;

  const tools: Record<string, ToolStat> = {};
  for (const c of calls)
    for (const [name, s] of Object.entries(c.tools)) {
      const agg = (tools[name] ??= { calls: 0, resultChars: 0, images: 0 });
      agg.calls += s.calls;
      agg.resultChars += s.resultChars;
      agg.images += s.images;
    }
  const toolRows = Object.entries(tools)
    .sort((a, b) => b[1].resultChars - a[1].resultChars)
    .map(([name, s]) => `| ${name} | ${s.calls} | ~${k(Math.round(s.resultChars / 4))} | ${s.images} |`);

  return [
    `# Cost breakdown (Agent SDK)`,
    ``,
    `Estimates from the SDK's \`modelUsage\`. "In" is uncached input; cache reads bill at a fraction of input, cache writes at a premium.`,
    ``,
    `| Call | Turns | In | Cache read | Cache write | Out | (thinking) | Est. cost |`,
    `|---|---|---|---|---|---|---|---|`,
    ...calls.map((c) => row(`${c.label}${c.ok ? "" : " ✗"}`, c.turns, c.tokens, c.costUsd)),
    row(`**Total**`, totals.turns, totals, totals.costUsd),
    ``,
    `## What the tools pulled into context`,
    ``,
    `Each result stays in context for every later turn of that call.`,
    ``,
    `| Tool | Calls | Result size (≈ tokens) | Images |`,
    `|---|---|---|---|`,
    ...toolRows,
    ``,
    `Per-turn detail is in usage.json.`,
  ].join("\n");
}
