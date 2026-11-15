import type { Campaign } from "./schema.ts";
import type { Scorecard } from "./score.ts";
import { needMarkers } from "./checks.ts";

const cell = (s: string) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function renderCampaign(c: Campaign): string {
  const out: string[] = [`# ${c.title}`, "", c.summary, "", "## Calendar", "", "| Date | Time | Segment | Email | Goal | Offer |", "|---|---|---|---|---|---|"];
  for (const r of c.calendar) out.push(`| ${cell(r.date)} | ${cell(`${r.time} ${r.timezone}`)} | ${cell(r.segment)} | ${cell(`${r.emailId} · ${r.emailName}`)} | ${cell(r.goal)} | ${cell(r.offer)} |`);
  if (c.segmentVolumes.length) {
    out.push("", "## Sends per segment", "", "| Segment | Sends | Note |", "|---|---|---|");
    for (const s of c.segmentVolumes) out.push(`| ${cell(s.segment)} | ${cell(s.sends)} | ${cell(s.note)} |`);
  }
  if (c.flowChanges.length) out.push("", "## Flow changes", "", ...c.flowChanges.map((f) => `- ${f}`));

  out.push("", "## Email specs");
  for (const e of c.emails) {
    out.push("", `### ${e.id} · ${e.name} · ${e.segment}`);
    if (e.status === "SPEC TO COME") {
      out.push("", "_SPEC TO COME_");
      continue;
    }
    out.push(
      "",
      `**Send:** ${e.sendDate} ${e.sendTime} ${e.timezone}  `,
      `**Goal:** ${e.goal}  `,
      `**Why:** ${e.why}`,
      "",
      "**Subject options:**",
      ...e.subjectOptions.map((s, i) => `${i + 1}. ${s.text} _(${s.why})_`),
      "",
      `**Preview:** ${e.preview}  `,
      `**Headline:** ${e.headline}  `,
      `**Subcopy:** ${e.subcopy}`,
      "",
      "**Body:**",
      ...e.body.map((b) => `- **${b.section}:** ${b.copy}${b.image ? ` _[image: ${b.image}]_` : ""}`),
      "",
      `**CTA:** ${e.ctas.map((x) => `${x.text} → ${x.destination}`).join(" · ")}  `,
      `**Exclusions:** ${e.exclusions}  `,
      `**Features:** ${[...e.collections, ...e.skus].join(", ") || "n/a"}`,
    );
    if (e.claims.length) out.push(`**Claims → sources:** ${e.claims.map((cl) => `"${cl.text}" → ${cl.source}`).join("; ")}`);
  }
  if (c.assumptions.length) out.push("", "## Assumptions", "", ...c.assumptions.map((a) => `- ${a}`));
  if (c.openDecisions.length) out.push("", "## Open decisions", "", ...c.openDecisions.map((d) => `- ${d}`));
  return out.join("\n");
}

const DIM_LABEL: Record<string, string> = {
  calendar_coverage: "Calendar coverage",
  segments_and_volume: "Segments and volume",
  variety_and_arc: "Variety and arc",
  offer_and_flows: "Offer and flows",
  client_ready: "Client-ready",
  brand_voice: "Brand voice and tone",
  one_job_one_path: "One job, one path",
  subject_and_preview: "Subject and preview",
  story_top_to_bottom: "Story top to bottom",
  buyer_and_gift_angle: "Buyer and gift angle",
  specific_not_generic: "Specific, not generic",
};
const mark = { pass: "✓", fail: "✗", blocked: "⏸" } as const;

export function renderScorecard(s: Scorecard, round: number, history: number[]): string {
  const out = [
    `REVIEW: ${s.items[0]?.label}`,
    `Reviewer note: independent grader (fresh context, never saw the writer's reasoning) + code checks`,
    `Round: ${round}${history.length > 1 ? ` · ${history.map((p, i) => `R${i + 1}: ${p}%`).join(" → ")}` : ""}`,
    `Status: ${s.status}`,
    `Overall: ${s.overallPct}% (bar: 80%, no dimension below 3, no failed gate)`,
  ];
  // Lowest-scoring emails first, after the campaign.
  const [camp, ...emails] = s.items;
  for (const it of [camp, ...emails.sort((a, b) => a.pct - b.pct)]) {
    if (!it) continue;
    out.push("", `── ${it.label} · ${it.pct}%${it.pct !== it.rawPct ? ` (capped from ${it.rawPct}%)` : ""}${it.meetsBar ? " · meets bar" : ""}`, "GATES");
    for (const g of it.gates) out.push(`${mark[g.result]} ${g.gate}${g.critical ? " (critical)" : ""} [${g.decidedBy}]: ${g.evidence.join(" ")}`);
    out.push("SCORES");
    for (const d of it.scores) out.push(`${(DIM_LABEL[d.dimension] ?? d.dimension).padEnd(24)} ${d.score ? `${d.score}/5` : "NOT SCORED"}  "${d.quote}"`);
  }
  const fix = s.fixes.filter((f) => f.type === "fix_now");
  const need = s.fixes.filter((f) => f.type === "needs_fact");
  const call = s.fixes.filter((f) => f.type === "your_call");
  if (fix.length) out.push("", "FIX NOW (in order)", ...fix.map((f, i) => `${i + 1}. ${f.where}: ${f.change} (+${f.points}%)`));
  if (need.length) out.push("", "NEEDS A FACT", ...need.map((f) => `- ${f.where}: ${f.change}`));
  if (call.length) out.push("", "YOUR CALL", ...call.map((f) => `- ${f.where}: ${f.change}`));
  if (s.stillWeak) out.push("", "STILL WEAK (plain words)", s.stillWeak);
  return out.join("\n");
}

/** The hand-off list: everything only the client or you can resolve. */
export function renderNeeds(c: Campaign, s: Scorecard): string {
  const out = ["# What I need from you", ""];
  const need = s.fixes.filter((f) => f.type === "needs_fact");
  if (c.needs.length || need.length) {
    out.push("## Facts to get from the client", "");
    for (const n of c.needs) out.push(`- **${n.item}**: ${n.whyItMatters} _Ask:_ ${n.askTheClient}`);
    for (const f of need) out.push(`- **${f.where}**: ${f.change}`);
    out.push("");
  }
  const markers = needMarkers(c);
  if (markers.length) out.push("## [NEED] markers still in the copy", "", ...markers.map((m) => `- ${m}`), "");
  if (c.assumptions.length) out.push("## Assumptions to confirm", "", ...c.assumptions.map((a) => `- ${a}`), "");
  const call = s.fixes.filter((f) => f.type === "your_call");
  if (c.openDecisions.length || call.length) out.push("## Your call", "", ...c.openDecisions.map((d) => `- ${d}`), ...call.map((f) => `- ${f.where}: ${f.change}`), "");
  out.push(
    "## Before anything is sent",
    "",
    "- Check the graphics and layout in the email platform. The grader only sees text.",
    "- Confirm every number and stock claim with the client.",
    "- Send yourself a test and read it on your phone.",
  );
  return out.join("\n");
}
