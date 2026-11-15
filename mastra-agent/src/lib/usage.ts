/** Token counts for one call or a whole run. `input` is uncached input only; cache reads and writes are separate. */
export type Tokens = { input: number; cacheRead: number; cacheWrite: number; cacheWrite1h: number; output: number; thinking: number };
/** One model request inside an agent call (Mastra calls these steps). */
export type StepStat = { step: number; tools: string[]; input: number; cacheRead: number; cacheWrite: number; output: number };

export type CallUsage = {
  label: string;
  model: string;
  ok: boolean;
  steps: number;
  durationMs: number;
  costUsd: number;
  tokens: Tokens;
  tools: Record<string, { calls: number }>;
  perStep: StepStat[];
};

export type UsageReport = { totals: Tokens & { calls: number; steps: number; costUsd: number }; calls: CallUsage[] };

/**
 * $/MTok. Cache writes bill at 1.25× input (5-minute TTL) or 2× input (1-hour TTL).
 * Models without a listed cache-read rate are estimated at 0.1× input. Unknown models report tokens only.
 */
const PRICES: Record<string, { input: number; output: number; cacheRead?: number }> = {
  "anthropic/claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "anthropic/claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "anthropic/claude-haiku-5-5": { input: 0.1, output: 0.5 },
};
export const hasPrice = (model: string) => model in PRICES;

export const emptyTokens = (): Tokens => ({ input: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, output: 0, thinking: 0 });

/** The usage fields Mastra reports (its `inputTokens` already includes cache reads and writes). */
type MastraUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheCreationInputTokens1h?: number;
};

export function tokensFromMastra(raw: unknown): Tokens {
  const u = (raw ?? {}) as MastraUsage;
  const cacheRead = u.cachedInputTokens ?? 0;
  const cacheWrite = u.cacheCreationInputTokens ?? 0;
  return {
    input: Math.max(0, (u.inputTokens ?? 0) - cacheRead - cacheWrite),
    cacheRead,
    cacheWrite,
    cacheWrite1h: u.cacheCreationInputTokens1h ?? 0,
    output: u.outputTokens ?? 0,
    thinking: u.reasoningTokens ?? 0,
  };
}

export function costOf(model: string, t: Tokens): number {
  const p = PRICES[model];
  if (!p) return 0;
  const read = p.cacheRead ?? p.input * 0.1;
  const write5m = Math.max(0, t.cacheWrite - t.cacheWrite1h);
  return (t.input * p.input + t.cacheRead * read + write5m * p.input * 1.25 + t.cacheWrite1h * p.input * 2 + t.output * p.output) / 1e6;
}

export function usageReport(calls: CallUsage[]): UsageReport {
  const totals = { ...emptyTokens(), calls: calls.length, steps: 0, costUsd: 0 };
  for (const c of calls) {
    for (const k of Object.keys(c.tokens) as (keyof Tokens)[]) totals[k] += c.tokens[k];
    totals.steps += c.steps;
    totals.costUsd += c.costUsd;
  }
  return { totals, calls };
}

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}K` : String(n));

/** One log line per finished call. */
export const usageLine = (c: CallUsage) =>
  `${c.steps} steps · ${k(c.tokens.input)} in · ${k(c.tokens.cacheRead)} cache read · ${k(c.tokens.cacheWrite)} cache write · ${k(c.tokens.output)} out (${k(c.tokens.thinking)} thinking)${hasPrice(c.model) ? ` · ~$${c.costUsd.toFixed(2)}` : ""}`;

/** cost.md: per-call table plus per-step detail, so cache hits and misses are visible. */
export function renderCost(report: UsageReport): string {
  const { totals, calls } = report;
  const row = (label: string, steps: number, t: Tokens, cost: number) =>
    `| ${label} | ${steps} | ${k(t.input)} | ${k(t.cacheRead)} | ${k(t.cacheWrite)} | ${k(t.output)} | ${k(t.thinking)} | $${cost.toFixed(2)} |`;
  return [
    `# Cost breakdown (Mastra)`,
    ``,
    `Estimated from Mastra's totalUsage (all steps) at list prices. "In" is uncached input; cache reads bill at a fraction of input, cache writes at a premium.`,
    ``,
    `| Call | Steps | In | Cache read | Cache write | Out | (thinking) | Est. cost |`,
    `|---|---|---|---|---|---|---|---|`,
    ...calls.map((c) => row(`${c.label}${c.ok ? "" : " ✗"}`, c.steps, c.tokens, c.costUsd)),
    row(`**Total**`, totals.steps, totals, totals.costUsd),
    ``,
    `## Steps`,
    ``,
    `| Call | Step | Tools | In | Cache read | Cache write | Out |`,
    `|---|---|---|---|---|---|---|`,
    ...calls.flatMap((c) => c.perStep.map((s) => `| ${c.label} | ${s.step} | ${s.tools.join(", ") || "—"} | ${k(s.input)} | ${k(s.cacheRead)} | ${k(s.cacheWrite)} | ${k(s.output)} |`)),
  ].join("\n");
}
