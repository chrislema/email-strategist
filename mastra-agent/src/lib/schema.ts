import { z } from "zod";

/* ───────────────────────────── Writer output ───────────────────────────── */

export const ClaimSchema = z.object({
  text: z.string().describe("The exact claim phrase as it appears in the copy, e.g. 'popular sizes are going fast'."),
  source: z
    .string()
    .describe("Where the claim comes from: a facts key such as 'inventoryNotes[0]', 'proofPoints[1]', 'drops[0]', 'offer', 'orderBy', or 'NEED' if the copy marks it [NEED: ...]."),
});

export const EmailSchema = z.object({
  id: z.string().describe("Short stable id, e.g. 'E1'. Keep ids unchanged across revisions."),
  name: z.string(),
  status: z.enum(["spec", "SPEC TO COME"]),
  segment: z.string(),
  sendDate: z.string().describe("YYYY-MM-DD"),
  sendTime: z.string().describe("e.g. '10:14 AM'"),
  timezone: z.string().describe("e.g. 'ET'"),
  goal: z.string(),
  why: z.string().describe("One line: why this email, to this segment, at this time."),
  subjectOptions: z.array(z.object({ text: z.string(), why: z.string() })),
  preview: z.string(),
  headline: z.string(),
  subcopy: z.string(),
  body: z.array(
    z.object({
      section: z.string(),
      copy: z.string(),
      image: z.string().describe("Asset filename to use, or '' if none."),
    }),
  ),
  ctas: z.array(z.object({ text: z.string(), destination: z.string() })),
  exclusions: z.string(),
  collections: z.array(z.string()).describe("Collection names featured, exactly as in the catalog."),
  skus: z.array(z.string()).describe("SKU codes featured, exactly as in the catalog."),
  claims: z.array(ClaimSchema).describe("Every stock, sales, review, urgency or brag claim in this email, with its source."),
});
export type Email = z.infer<typeof EmailSchema>;

export const CampaignSchema = z.object({
  title: z.string(),
  type: z.enum(["season_plan", "drop_launch", "flow", "single_email"]),
  summary: z.string().describe("2-3 sentences a client could read cold."),
  calendar: z.array(
    z.object({
      emailId: z.string(),
      date: z.string(),
      time: z.string(),
      timezone: z.string(),
      segment: z.string(),
      emailName: z.string(),
      goal: z.string(),
      offer: z.string(),
    }),
  ),
  segmentVolumes: z.array(z.object({ segment: z.string(), sends: z.string(), note: z.string() })),
  flowChanges: z.array(z.string()),
  emails: z.array(EmailSchema),
  assumptions: z.array(z.string()).describe("Everything marked [ASSUMED: ...], one per line."),
  needs: z.array(z.object({ item: z.string(), whyItMatters: z.string(), askTheClient: z.string() })),
  openDecisions: z.array(z.string()),
});
export type Campaign = z.infer<typeof CampaignSchema>;

/* ───────────────────────────── Grader output ───────────────────────────── */

export const GateResult = z.enum(["pass", "fail", "blocked"]);
export type GateResult = z.infer<typeof GateResult>;

export const CAMPAIGN_GATES = ["C1", "C2", "C3", "C4", "C5", "C6"] as const;
export const EMAIL_GATES = ["E1", "E2", "E3", "E4"] as const;
export const CRITICAL_GATES = new Set(["C1", "C2", "C3", "C4", "E1"]);

export const CAMPAIGN_DIMENSIONS = {
  calendar_coverage: 20,
  segments_and_volume: 20,
  variety_and_arc: 20,
  offer_and_flows: 15,
  client_ready: 25,
} as const;
export const EMAIL_DIMENSIONS = {
  brand_voice: 25,
  one_job_one_path: 20,
  subject_and_preview: 15,
  story_top_to_bottom: 15,
  buyer_and_gift_angle: 15,
  specific_not_generic: 10,
} as const;

const gate = <T extends readonly [string, ...string[]]>(ids: T) =>
  z.object({
    gate: z.enum(ids),
    result: GateResult.describe("pass | fail | blocked. Use blocked ONLY when the work can't pass without a client-only fact AND it marks that gap [NEED: ...]."),
    quote: z.string().describe("The line that decides it."),
    note: z.string(),
  });

const score = <T extends readonly [string, ...string[]]>(dims: T) =>
  z.object({
    dimension: z.enum(dims),
    score: z.number().int().describe("1-5, or 0 for NOT SCORED"),
    quote: z.string().describe("The line that earned the score. No quote, no score above 2."),
  });

const campaignDims = Object.keys(CAMPAIGN_DIMENSIONS) as [keyof typeof CAMPAIGN_DIMENSIONS, ...(keyof typeof CAMPAIGN_DIMENSIONS)[]];
const emailDims = Object.keys(EMAIL_DIMENSIONS) as [keyof typeof EMAIL_DIMENSIONS, ...(keyof typeof EMAIL_DIMENSIONS)[]];

export const FixSchema = z.object({
  where: z.string().describe("Email id + field, or 'Campaign: <section>'."),
  change: z.string().describe("The exact edit, written against this draft."),
  type: z.enum(["fix_now", "needs_fact", "your_call"]),
  points: z.number().describe("Rough % the overall score rises if fixed."),
});
export type Fix = z.infer<typeof FixSchema>;

export const ReviewSchema = z.object({
  campaignGates: z.array(gate(CAMPAIGN_GATES)),
  campaignScores: z.array(score(campaignDims)),
  emails: z.array(
    z.object({
      emailId: z.string(),
      gates: z.array(gate(EMAIL_GATES)),
      scores: z.array(score(emailDims)),
    }),
  ),
  fixes: z.array(FixSchema),
  stillWeak: z.string().describe("Plain-words summary of what is still weak, for the human."),
});
export type Review = z.infer<typeof ReviewSchema>;

/** JSON Schema for the SDK's structured output. */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}
