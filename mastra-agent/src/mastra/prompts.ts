import fs from "node:fs";
import type { Brief } from "../lib/brief";
import type { CheckReport } from "../lib/checks";
import type { Campaign, Fix } from "../lib/schema";
import { renderCampaign } from "../lib/report";
import type { PreparedImage } from "../lib/images";

const read = (p: string | null) => (p && p.endsWith(".txt") && fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);

function references(brief: Brief): string {
  const guide = read(brief.brandGuidePath);
  return [
    "<brief>",
    fs.readFileSync(brief.briefPath, "utf8"),
    "</brief>",
    "",
    "<brand_guide>",
    guide ?? "(No brand guide text available. Say so in needs[] and mark brand-dependent choices [ASSUMED].)",
    "</brand_guide>",
  ].join("\n");
}

type UserContent = ({ type: "text"; text: string } | { type: "image"; image: Buffer; mimeType: string })[];

export function draftMessages(brief: Brief, idea: string, images: PreparedImage[]) {
  const content: UserContent = [
    {
      type: "text",
      text: `${references(brief)}

Today is ${brief.today}.

IDEA: ${idea}

Deliver the whole thing as one campaign: calendar first, segment volumes, flow changes, then a full spec for every
email on the calendar. If the idea is a full season, write full specs for the core sends and mark the rest
status "SPEC TO COME" (they still go on the calendar). End with needs[] and openDecisions[].
${images.length ? `\nThe images below are each collection's main artwork, in this order: ${images.map((i) => `"${i.collection}" (${i.file})`).join(", ")}. Use them for the look and feel of the print; refer to image files by these names.` : ""}`,
    },
    ...images.map((i) => ({ type: "image" as const, image: i.data, mimeType: i.mimeType })),
  ];
  return [{ role: "user" as const, content }];
}

export function reviseMessages(brief: Brief, campaign: Campaign, fixes: Fix[], round: number) {
  return `${references(brief)}

A reviewer sent back round ${round} fixes. Make ONLY these changes. Don't rewrite lines that weren't flagged,
keep every email id unchanged, and keep the same structure.

FIXES (in priority order):
${fixes.map((f, i) => `${i + 1}. [${f.where}] ${f.change}`).join("\n")}

CURRENT CAMPAIGN (JSON):
${JSON.stringify(campaign, null, 2)}

Return the full revised campaign. If a fix can't be made without a client fact, leave a [NEED: ...] marker,
add it to needs[], and move on.`;
}

export function gradeMessages(brief: Brief, campaign: Campaign, checks: CheckReport, round: number) {
  const machine = checks.results.map((r) => `- ${r.scope} ${r.gate}: ${r.result.toUpperCase()} · ${r.evidence.join(" ")}`).join("\n");
  return `${references(brief)}

Score this campaign with the Campaign rubric, then every email whose status is "spec" with the Email rubric.
Skip "SPEC TO COME" emails (they count against Client-ready).

MACHINE CHECKS (already verified in code; treat as fact, don't re-litigate them, but you may fail a gate the
code passed if you find a problem it can't see, such as a claim worded around the patterns):
${machine}

Gate results: pass | fail | blocked. Use "blocked" only when the work can't pass without a client-only fact
AND the copy marks that gap [NEED: ...]. That is not the writer's fault and not a fail.

Fixes: every failed gate and every dimension below 5 gets one. Type "fix_now" if the writer can make the edit
today, "needs_fact" if it needs the client, "your_call" for scope or taste. Write each change against this
exact draft.

This is review round ${round}.

THE WORK:
${renderCampaign(campaign)}`;
}
