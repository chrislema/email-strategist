import { config, GRADER_SKILLS } from "../config.ts";
import { ReviewSchema, type Campaign } from "../schema.ts";
import type { CheckReport } from "../checks.ts";
import type { Brief } from "../brief.ts";
import { renderCampaign } from "../report.ts";
import { runAgent, type UsageSink } from "./run.ts";

const SYSTEM = `
You are the reviewer, not the writer. You have never seen this work before. Be strict: a generous score now
becomes an embarrassing email in the client's inbox later. Quote the line behind every gate and score.
Don't compute the overall percentage; the pipeline does that from your dimension scores.
You are read-only: read the brand guide and brief, then return the review as structured output.
`.trim();

export async function gradeCampaign(brief: Brief, campaign: Campaign, checks: CheckReport, round: number, onUsage?: UsageSink) {
  const machine = checks.results
    .map((r) => `- ${r.scope} ${r.gate}: ${r.result.toUpperCase()} · ${r.evidence.join(" ")}`)
    .join("\n");

  const prompt = `
Use the email-campaign-review skill. Score this campaign with the Campaign rubric, then every email whose
status is "spec" with the Email rubric. Skip "SPEC TO COME" emails (they count against Client-ready).

Reference material:
- Brand guide: ${brief.brandGuidePath ?? "(missing: mark brand dimensions 0 = NOT SCORED)"}
- Brief with the client's facts and the computed order-by date: ${brief.briefPath}

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
${renderCampaign(campaign)}
`.trim();

  return runAgent({
    label: `grader r${round}`,
    prompt,
    schema: ReviewSchema,
    model: config.graderModel,
    effort: config.graderEffort,
    skills: GRADER_SKILLS,
    extraDirs: brief.readableDirs,
    system: SYSTEM,
    onUsage,
  });
}
