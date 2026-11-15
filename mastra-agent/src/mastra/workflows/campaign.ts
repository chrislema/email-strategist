import fs from "node:fs";
import path from "node:path";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import type { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { config } from "../../lib/config";
import { buildBrief, type Brief } from "../../lib/brief";
import { runChecks } from "../../lib/checks";
import { buildScorecard, fixNow, isDone, type Scorecard } from "../../lib/score";
import { renderCampaign, renderNeeds, renderScorecard } from "../../lib/report";
import { prepareHeroImages } from "../../lib/images";
import { CampaignSchema, ReviewSchema, type Campaign } from "../../lib/schema";
import { draftMessages, gradeMessages, reviseMessages } from "../prompts";

/* ── helpers ──────────────────────────────────────────────────────────── */

const say = (msg: string) => process.stderr.write(`${msg}\n`);
const write = (dir: string, name: string, body: string | object) => {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  return p;
};

/** $/MTok (input, output) for cost estimates; unknown models report tokens only. */
const PRICES: Record<string, [number, number]> = {
  "anthropic/claude-opus-5-5": [4, 20],
  "anthropic/claude-sonnet-5-5": [2, 10],
  "anthropic/claude-haiku-5-5": [0.1, 0.5],
};
type Usage = { inputTokens: number; outputTokens: number; costUsd: number };
const addUsage = (a: Usage, b: Usage): Usage => ({ inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, costUsd: a.costUsd + b.costUsd });

async function generateStructured<S extends z.ZodType>(
  agent: Agent,
  label: string,
  messages: Parameters<Agent["generate"]>[0],
  schema: S,
  model: string,
  effort: "low" | "medium" | "high" | "xhigh" | "max",
): Promise<{ object: z.infer<S>; usage: Usage }> {
  say(`  [${label}] generating with ${model}…`);
  const res = await agent.generate(messages, {
    maxSteps: 12,
    // The campaign schema is too large for Anthropic's strict output grammar ("compiled grammar is too large"),
    // so the schema goes in the prompt and Mastra validates the reply against it.
    structuredOutput: { schema: schema as unknown as z.ZodObject<z.ZodRawShape>, jsonPromptInjection: true },
    modelSettings: { maxOutputTokens: config.maxOutputTokens },
    providerOptions: { anthropic: { thinking: { type: "adaptive" }, effort } },
    onStepFinish: (event) => {
      for (const t of event.toolCalls ?? []) {
        const name = t.payload?.toolName;
        const arg = (t.payload?.args as Record<string, unknown> | undefined)?.name as string | undefined;
        say(`  [${label}] ${name}${arg ? ` ${arg}` : ""}`);
      }
    },
  });
  const parsed = schema.safeParse(res.object);
  if (!parsed.success) throw new Error(`${label} returned output that doesn't match the schema: ${parsed.error.message.slice(0, 800)}`);
  const u = (res.usage ?? {}) as { inputTokens?: number; outputTokens?: number };
  const [pin, pout] = PRICES[model] ?? [0, 0];
  const usage = { inputTokens: u.inputTokens ?? 0, outputTokens: u.outputTokens ?? 0, costUsd: ((u.inputTokens ?? 0) * pin + (u.outputTokens ?? 0) * pout) / 1e6 };
  say(`  [${label}] done · ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out${PRICES[model] ? ` · ~$${usage.costUsd.toFixed(2)}` : ""}`);
  return { object: parsed.data, usage };
}

/* ── schemas passed between steps ─────────────────────────────────────── */

const UsageSchema = z.object({ inputTokens: z.number(), outputTokens: z.number(), costUsd: z.number() });
const LoopSchema = z.object({
  idea: z.string(),
  maxRounds: z.number(),
  brief: z.custom<Brief>(),
  campaign: CampaignSchema,
  round: z.number(),
  history: z.array(z.number()),
  scorecard: z.custom<Scorecard>().optional(),
  done: z.boolean(),
  stopReason: z.string(),
  usage: UsageSchema,
});
type Loop = z.infer<typeof LoopSchema>;

const ResultSchema = z.object({
  runDir: z.string(),
  status: z.string(),
  overallPct: z.number(),
  rounds: z.number(),
  history: z.array(z.number()),
  stopReason: z.string(),
  usage: UsageSchema,
  files: z.object({ campaign: z.string(), scorecard: z.string(), needs: z.string() }),
});

/* ── steps ────────────────────────────────────────────────────────────── */

/** Intake + first draft. Code builds the brief; the writer drafts with the brief, brand guide and hero images inline. */
const draft = createStep({
  id: "intake-and-draft",
  description: "Load facts, compute the order-by date, build the catalog, then have the writer draft the campaign.",
  inputSchema: z.object({ idea: z.string(), factsPath: z.string().optional(), maxRounds: z.number().optional() }),
  outputSchema: LoopSchema,
  execute: async ({ inputData, mastra }) => {
    say(`\n▸ Intake`);
    const brief = buildBrief(inputData.idea, inputData.factsPath);
    say(`  run folder: ${brief.runDir}`);
    say(`  order-by: ${brief.orderBy.status === "computed" ? `${brief.orderBy.display} (${brief.orderBy.method})` : `BLOCKED: ${brief.orderBy.reason}`}`);
    const images = prepareHeroImages(brief.catalog, inputData.idea, brief.runDir, config.maxImages);
    say(`  hero images: ${images.map((i) => i.collection).join(", ") || "none"}`);

    say(`\n▸ Round 1 · writing`);
    const writer = mastra.getAgent("campaignWriter");
    const { object, usage } = await generateStructured(writer, "writer", draftMessages(brief, inputData.idea, images), CampaignSchema, config.writerModel, config.writerEffort);
    return {
      idea: inputData.idea,
      maxRounds: inputData.maxRounds ?? config.maxRounds,
      brief,
      campaign: object,
      round: 1,
      history: [],
      done: false,
      stopReason: "",
      usage,
    };
  },
});

/** One round: code checks → independent grade → code scorecard → (if not done) writer fixes. Loops via dountil. */
const reviewRound = createStep({
  id: "check-grade-fix",
  description: "Run code gates, get an independent grade, score it in code, and send Fix Now items back to the writer.",
  inputSchema: LoopSchema,
  outputSchema: LoopSchema,
  execute: async ({ inputData, mastra }): Promise<Loop> => {
    const s = inputData;
    const dir = path.join(s.brief.runDir, `round-${s.round}`);
    write(dir, "campaign.json", s.campaign);
    write(dir, "campaign.md", renderCampaign(s.campaign));

    say(`\n▸ Round ${s.round} · checking (code)`);
    const checks = runChecks(s.campaign, s.brief.facts, s.brief.orderBy, s.brief.catalog);
    write(dir, "checks.json", checks);
    const fails = checks.results.filter((r) => r.result === "fail");
    say(`  ${checks.results.length} checks · ${fails.length} failed${fails.length ? `: ${[...new Set(fails.map((f) => `${f.scope}/${f.gate}`))].join(", ")}` : ""}`);

    say(`\n▸ Round ${s.round} · grading (independent reviewer)`);
    const grader = mastra.getAgent("campaignGrader");
    const graded = await generateStructured(grader, `grader r${s.round}`, gradeMessages(s.brief, s.campaign, checks, s.round), ReviewSchema, config.graderModel, config.graderEffort);
    write(dir, "review.json", graded.object);
    let usage = addUsage(s.usage, graded.usage);

    const card = buildScorecard(s.campaign, checks, graded.object);
    const history = [...s.history, card.overallPct];
    write(dir, "scorecard.md", renderScorecard(card, s.round, history));
    say(`  ${card.status} · ${card.overallPct}%${history.length > 1 ? ` (${history.map((p) => `${p}%`).join(" → ")})` : ""}`);

    const base = { ...s, scorecard: card, history, usage };
    if (isDone(card)) return { ...base, done: true, stopReason: card.status === "CLIENT-READY" ? "Cleared the bar." : "Cleared the bar on everything it could; the rest needs facts." };
    const todo = fixNow(card);
    if (!todo.length) return { ...base, done: true, stopReason: "Nothing left the writer can fix; everything remaining needs a fact or your call." };
    if (s.round >= s.maxRounds) return { ...base, done: true, stopReason: `Stopped after ${s.maxRounds} rounds (more rounds chase the number, not the emails).` };

    say(`\n▸ Round ${s.round + 1} · fixing ${todo.length} item(s)`);
    const writer = mastra.getAgent("campaignWriter");
    const revised = await generateStructured(writer, `writer r${s.round + 1}`, reviseMessages(s.brief, s.campaign, todo, s.round + 1), CampaignSchema, config.writerModel, config.writerEffort);
    usage = addUsage(usage, revised.usage);
    return { ...base, campaign: revised.object as Campaign, round: s.round + 1, usage, done: false };
  },
});

/** Present: write the final campaign, scorecard and needs list. Only reached once the loop is done. */
const present = createStep({
  id: "present",
  description: "Write the final campaign, scorecard and the list of facts still needed.",
  inputSchema: LoopSchema,
  outputSchema: ResultSchema,
  execute: async ({ inputData: s }) => {
    const card = s.scorecard!;
    const final = path.join(s.brief.runDir, "final");
    const files = {
      campaign: write(final, "campaign.md", renderCampaign(s.campaign)),
      scorecard: write(final, "scorecard.md", renderScorecard(card, s.round, s.history)),
      needs: write(final, "needs.md", renderNeeds(s.campaign, card)),
    };
    write(final, "campaign.json", s.campaign);
    const result = { runDir: s.brief.runDir, status: card.status, overallPct: card.overallPct, rounds: s.history.length, history: s.history, stopReason: s.stopReason, usage: s.usage, files };
    write(final, "summary.json", result);
    return result;
  },
});

export const campaignWorkflow = createWorkflow({
  id: "campaign-workflow",
  description: "Idea in, graded email campaign out: draft → (code checks → independent grade → fix) until it clears the bar or hits the round cap.",
  inputSchema: z.object({ idea: z.string(), factsPath: z.string().optional(), maxRounds: z.number().optional() }),
  outputSchema: ResultSchema,
})
  .then(draft)
  .dountil(reviewRound, async ({ inputData }) => inputData.done)
  .then(present)
  .commit();
