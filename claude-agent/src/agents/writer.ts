import { config, WRITER_SKILLS } from "../config.ts";
import { CampaignSchema, type Campaign, type Fix } from "../schema.ts";
import type { Brief } from "../brief.ts";
import { runAgent } from "./run.ts";

const SYSTEM = `
You are the campaign writer for a direct-to-consumer product brand's email program.
You plan campaigns and write every email spec. A separate reviewer will grade your work strictly;
you will not see the rubric, only the fixes it asks for.

Hard rules:
- The brand guide wins on voice, headline length, CTA wording and button style.
- Name collections and SKUs exactly as the catalog lists them. Never invent a product, print or size.
- Never invent reviews, sales numbers, stock levels, "best-seller" or "most-loved" claims. If copy needs proof
  you don't have, write [NEED: ...] in the copy and list it in claims with source "NEED".
- Every claim, urgency or brag line goes in that email's claims[] with a source key from the facts
  (inventoryNotes[i], proofPoints[i], drops[i], offer, orderBy) or "NEED".
- Use the computed order-by date exactly as given. If it is BLOCKED, write [NEED: order-by date] instead of a date.
- If the offer isn't decided, don't state a deal: write [NEED: offer] and keep the copy offer-agnostic.
- Every deadline gets a time and a time zone ("11:59 PM ET"), never "midnight".
- Mark every assumption [ASSUMED: ...] in the copy and list it in assumptions[].
- Don't stop to ask questions. Finish everything you can, and list what you need in needs[] and openDecisions[].
- You are read-only: read the brief, brand guide, catalog and images, then return the campaign as structured output.
`.trim();

export async function draftCampaign(brief: Brief, idea: string) {
  const prompt = `
Use the ecommerce-holiday-email skill (and copywriting / offers where they help) to plan and write this:

IDEA: ${idea}

Read these first:
- Brand guide: ${brief.brandGuidePath ?? "(none found: say so in needs[])"}
- Brief (facts, computed order-by date, catalog): ${brief.briefPath}
- Product and lifestyle images live under: ${brief.assetsDir}. Look at a few of the most relevant (at most 6) before writing.

Today is ${brief.today}.

Deliver the whole thing as one campaign: calendar first, segment volumes, flow changes, then a full spec for every
email on the calendar. If the idea is a full season, write full specs for the core sends and mark the rest
status "SPEC TO COME" (they still go on the calendar). End with needs[] and openDecisions[].
`.trim();

  return runAgent({
    label: "writer",
    prompt,
    schema: CampaignSchema,
    model: config.writerModel,
    effort: config.writerEffort,
    skills: WRITER_SKILLS,
    extraDirs: brief.readableDirs,
    hideReviewRubric: true,
    system: SYSTEM,
  });
}

export async function reviseCampaign(brief: Brief, campaign: Campaign, fixes: Fix[], round: number) {
  const prompt = `
A reviewer sent back round ${round} fixes. Make ONLY these changes. Don't rewrite lines that weren't flagged,
keep every email id unchanged, and keep the same structure.

FIXES (in priority order):
${fixes.map((f, i) => `${i + 1}. [${f.where}] ${f.change}`).join("\n")}

Reference material (unchanged): brand guide ${brief.brandGuidePath}, brief ${brief.briefPath}.

CURRENT CAMPAIGN (JSON):
${JSON.stringify(campaign, null, 2)}

Return the full revised campaign. If a fix can't be made without a client fact, leave a [NEED: ...] marker,
add it to needs[], and move on.
`.trim();

  return runAgent({
    label: `writer r${round}`,
    prompt,
    schema: CampaignSchema,
    model: config.writerModel,
    effort: config.writerEffort,
    skills: WRITER_SKILLS,
    extraDirs: brief.readableDirs,
    hideReviewRubric: true,
    system: SYSTEM,
  });
}
