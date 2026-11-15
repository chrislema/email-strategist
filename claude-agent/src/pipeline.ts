import fs from "node:fs";
import path from "node:path";
import { config } from "./config.ts";
import { buildBrief, type Brief } from "./brief.ts";
import { runChecks } from "./checks.ts";
import { draftCampaign, reviseCampaign } from "./agents/writer.ts";
import { gradeCampaign } from "./agents/grader.ts";
import { buildScorecard, fixNow, isDone, type Scorecard } from "./score.ts";
import { renderCampaign, renderNeeds, renderScorecard } from "./report.ts";
import type { Campaign } from "./schema.ts";

export type RunResult = {
  runDir: string;
  status: Scorecard["status"];
  overallPct: number;
  rounds: number;
  history: number[];
  stopReason: string;
  costUsd: number;
  files: { campaign: string; scorecard: string; needs: string };
};

const say = (msg: string) => process.stderr.write(`${msg}\n`);
const write = (dir: string, name: string, body: string | object) => {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body, null, 2));
  return p;
};

/**
 * Idea → intake → draft → [code checks → independent grade → score] → fix → … → present.
 * Nothing is presented until the loop ends: CLIENT-READY, READY PENDING FACTS (finished what it could, here's the
 * list), nothing left the writer can fix, or the round cap.
 */
export async function runCampaign(idea: string, opts: { factsPath?: string; maxRounds?: number } = {}): Promise<RunResult> {
  const maxRounds = opts.maxRounds ?? config.maxRounds;
  say(`\n▸ Intake`);
  const brief: Brief = buildBrief(idea, opts.factsPath);
  say(`  run folder: ${brief.runDir}`);
  say(`  order-by: ${brief.orderBy.status === "computed" ? `${brief.orderBy.display} (${brief.orderBy.method})` : `BLOCKED: ${brief.orderBy.reason}`}`);
  say(`  catalog: ${brief.catalog.collections.map((c) => c.name).join(", ")}`);

  let cost = 0;
  say(`\n▸ Round 1 · writing`);
  const draft = await draftCampaign(brief, idea);
  cost += draft.costUsd;
  let campaign: Campaign = draft.output;

  const history: number[] = [];
  let card!: Scorecard;
  let stopReason = "";
  let round = 1;

  for (; round <= maxRounds; round++) {
    const dir = path.join(brief.runDir, `round-${round}`);
    write(dir, "campaign.json", campaign);
    write(dir, "campaign.md", renderCampaign(campaign));

    say(`\n▸ Round ${round} · checking (code)`);
    const checks = runChecks(campaign, brief.facts, brief.orderBy, brief.catalog);
    write(dir, "checks.json", checks);
    const fails = checks.results.filter((r) => r.result === "fail");
    say(`  ${checks.results.length} checks · ${fails.length} failed${fails.length ? `: ${[...new Set(fails.map((f) => `${f.scope}/${f.gate}`))].join(", ")}` : ""}`);

    say(`\n▸ Round ${round} · grading (independent reviewer)`);
    const graded = await gradeCampaign(brief, campaign, checks, round);
    cost += graded.costUsd;
    write(dir, "review.json", graded.output);

    card = buildScorecard(campaign, checks, graded.output);
    history.push(card.overallPct);
    write(dir, "scorecard.md", renderScorecard(card, round, history));
    say(`  ${card.status} · ${card.overallPct}%${history.length > 1 ? ` (${history.map((p) => `${p}%`).join(" → ")})` : ""}`);

    if (isDone(card)) {
      stopReason = card.status === "CLIENT-READY" ? "Cleared the bar." : "Cleared the bar on everything it could; the rest needs facts.";
      break;
    }
    const todo = fixNow(card);
    if (!todo.length) {
      stopReason = "Nothing left the writer can fix; everything remaining needs a fact or your call.";
      break;
    }
    if (round === maxRounds) {
      stopReason = `Stopped after ${maxRounds} rounds (more rounds chase the number, not the emails).`;
      break;
    }
    say(`\n▸ Round ${round + 1} · fixing ${todo.length} item(s)`);
    const revised = await reviseCampaign(brief, campaign, todo, round + 1);
    cost += revised.costUsd;
    campaign = revised.output;
  }

  const final = path.join(brief.runDir, "final");
  const files = {
    campaign: write(final, "campaign.md", renderCampaign(campaign)),
    scorecard: write(final, "scorecard.md", renderScorecard(card, Math.min(round, maxRounds), history)),
    needs: write(final, "needs.md", renderNeeds(campaign, card)),
  };
  write(final, "campaign.json", campaign);
  const result: RunResult = { runDir: brief.runDir, status: card.status, overallPct: card.overallPct, rounds: history.length, history, stopReason, costUsd: cost, files };
  write(final, "summary.json", result);
  return result;
}
