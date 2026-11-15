import { config } from "./config";
import type { CheckReport } from "./checks";
import {
  CAMPAIGN_DIMENSIONS,
  CAMPAIGN_GATES,
  CRITICAL_GATES,
  EMAIL_DIMENSIONS,
  EMAIL_GATES,
  type Campaign,
  type Fix,
  type GateResult,
  type Review,
} from "./schema";

export type FinalGate = { gate: string; result: GateResult; critical: boolean; evidence: string[]; decidedBy: "code" | "grader" | "both" };
export type ScoredItem = {
  scope: "campaign" | string;
  label: string;
  gates: FinalGate[];
  scores: { dimension: string; weight: number; score: number; quote: string }[];
  rawPct: number;
  pct: number;
  meetsBar: boolean;
  deliverable: boolean;
  blocked: boolean;
};

export type Status = "CLIENT-READY" | "READY PENDING FACTS" | "NOT YET" | "NOT DELIVERABLE";
export type Scorecard = { status: Status; overallPct: number; items: ScoredItem[]; fixes: Fix[]; stillWeak: string };

const rank: Record<GateResult, number> = { pass: 0, blocked: 1, fail: 2 };

/** Code results are authoritative where they exist; the grader can make a gate worse, never better. */
function mergeGate(gate: string, scope: string, checks: CheckReport, grader?: { result: GateResult; quote: string; note: string }): FinalGate {
  const code = checks.results.find((r) => r.gate === gate && r.scope === scope);
  const critical = CRITICAL_GATES.has(gate);
  if (!code && !grader) return { gate, result: "pass", critical, evidence: ["Not assessed."], decidedBy: "grader" };
  if (!code) return { gate, result: grader!.result, critical, evidence: [grader!.quote, grader!.note].filter(Boolean), decidedBy: "grader" };
  if (!grader) return { gate, result: code.result, critical, evidence: code.evidence, decidedBy: "code" };
  // Grader may say "blocked" for a fact gap, but can't downgrade a code fail or upgrade a code result.
  const worst = rank[grader.result] > rank[code.result] ? grader.result : code.result;
  return {
    gate,
    result: worst,
    critical,
    evidence: [...code.evidence, ...(grader.result !== "pass" ? [`Grader: ${grader.quote} ${grader.note}`.trim()] : [])],
    decidedBy: "both",
  };
}

function pctOf(scores: { weight: number; score: number }[]): number {
  const scored = scores.filter((s) => s.score >= 1);
  const w = scored.reduce((a, s) => a + s.weight, 0);
  if (!w) return 0;
  const avg = scored.reduce((a, s) => a + s.weight * s.score, 0) / w;
  return Math.round(((avg - 1) / 4) * 100);
}

function scoreItem(scope: string, label: string, gates: FinalGate[], scores: ScoredItem["scores"]): ScoredItem {
  const rawPct = pctOf(scores);
  const criticalFail = gates.some((g) => g.critical && g.result === "fail");
  const minorFail = gates.some((g) => !g.critical && g.result === "fail");
  const pct = minorFail ? Math.min(rawPct, config.bar.minorGateCapPct) : rawPct;
  const minDim = Math.min(...scores.filter((s) => s.score >= 1).map((s) => s.score), 5);
  const blocked = gates.some((g) => g.result === "blocked");
  return {
    scope,
    label,
    gates,
    scores,
    rawPct,
    pct,
    deliverable: !criticalFail,
    blocked,
    meetsBar: !criticalFail && !minorFail && pct >= config.bar.overallPct && minDim >= config.bar.minDimension,
  };
}

export function buildScorecard(campaign: Campaign, checks: CheckReport, review: Review): Scorecard {
  const items: ScoredItem[] = [];

  const cGates = CAMPAIGN_GATES.map((g) => mergeGate(g, "campaign", checks, review.campaignGates.find((x) => x.gate === g)));
  const cScores = Object.entries(CAMPAIGN_DIMENSIONS).map(([dimension, weight]) => {
    const s = review.campaignScores.find((x) => x.dimension === dimension);
    return { dimension, weight, score: s?.score ?? 0, quote: s?.quote ?? "NOT SCORED" };
  });
  items.push(scoreItem("campaign", campaign.title, cGates, cScores));

  for (const e of campaign.emails.filter((x) => x.status === "spec")) {
    const r = review.emails.find((x) => x.emailId === e.id);
    const gates = EMAIL_GATES.map((g) => mergeGate(g, e.id, checks, r?.gates.find((x) => x.gate === g)));
    const scores = Object.entries(EMAIL_DIMENSIONS).map(([dimension, weight]) => {
      const s = r?.scores.find((x) => x.dimension === dimension);
      return { dimension, weight, score: s?.score ?? 0, quote: s?.quote ?? "NOT SCORED" };
    });
    // An email the grader skipped can't meet the bar.
    if (!r) scores.forEach((s) => (s.score = 1));
    items.push(scoreItem(e.id, `${e.id} · ${e.name}`, gates, scores));
  }

  // Fixes: code-found first (they're certain), then the grader's, deduped by location.
  const seen = new Set<string>();
  const fixes = [...checks.fixes, ...review.fixes].filter((f) => {
    const k = `${f.where}|${f.change}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // Blocked gates are fact gaps, never something the writer can fix.
  for (const it of items) for (const g of it.gates) if (g.result === "blocked") fixes.push({ where: `${it.label}: ${g.gate}`, change: g.evidence.join(" "), type: "needs_fact", points: 0 });
  const order = { fix_now: 0, needs_fact: 1, your_call: 2 } as const;
  fixes.sort((a, b) => order[a.type] - order[b.type] || b.points - a.points);

  const overallPct = Math.round(items.reduce((a, i) => a + i.pct, 0) / items.length);
  const anyCritical = items.some((i) => !i.deliverable);
  const allMeet = items.every((i) => i.meetsBar);
  const anyBlocked = items.some((i) => i.blocked);
  const status: Status = anyCritical ? "NOT DELIVERABLE" : allMeet ? (anyBlocked ? "READY PENDING FACTS" : "CLIENT-READY") : "NOT YET";

  return { status, overallPct, items, fixes, stillWeak: review.stillWeak };
}

export const isDone = (s: Scorecard) => s.status === "CLIENT-READY" || s.status === "READY PENDING FACTS";
export const fixNow = (s: Scorecard) => s.fixes.filter((f) => f.type === "fix_now");
