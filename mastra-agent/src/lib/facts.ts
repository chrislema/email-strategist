import fs from "node:fs";
import { z } from "zod";

/**
 * The facts a campaign depends on (setup guide, Step 5). Anything unknown is "not sure":
 * the writer then marks it [ASSUMED] or [NEED], and the gates that depend on it go BLOCKED
 * instead of failing, so the run finishes and hands back a list.
 */
const NotSure = z.literal("not sure");
const numOrUnknown = z.union([z.number(), NotSure]).default("not sure");

export const FactsSchema = z.object({
  brand: z.string().min(1),
  platform: z.string().default("not sure"),
  listSize: numOrUnknown,
  engaged90d: numOrUnknown,
  /** The offer as decided, or "help me decide". */
  offer: z.string().default("help me decide"),
  grossMarginPct: numOrUnknown,
  /** Collections to feature. Empty = let the writer choose from the catalog. */
  collections: z.array(z.string()).default([]),
  /** Business days from order to handed to the carrier. */
  handlingDays: numOrUnknown,
  /** Carrier last-ship date for Christmas delivery. */
  carrier: z
    .object({
      service: z.string(),
      lastShipDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      source: z.string().default("client"),
    })
    .or(NotSure)
    .default("not sure"),
  bufferDays: z.number().int().min(0).default(1),
  sendsSms: z.union([z.boolean(), NotSure]).default("not sure"),
  aov: numOrUnknown,
  timezone: z.string().default("ET"),
  drops: z
    .array(z.object({ collection: z.string(), date: z.string(), time: z.string() }))
    .default([]),
  /** Only these may back "low stock", "only N left", "selling fast". */
  inventoryNotes: z.array(z.string()).default([]),
  /** Only these may back reviews, "best-selling", "most-loved", sales numbers. */
  proofPoints: z.array(z.string()).default([]),
  /** Optional SKU prefix → product type, e.g. { "PJ": "Kids pajamas" }. */
  skuTypes: z.record(z.string(), z.string()).default({}),
  brandRules: z
    .object({
      headlineWords: z.tuple([z.number(), z.number()]).default([4, 7]),
      ctaCount: z.tuple([z.number(), z.number()]).default([1, 2]),
    })
    .default({ headlineWords: [4, 7], ctaCount: [1, 2] }),
  notes: z.string().default(""),
});
export type Facts = z.infer<typeof FactsSchema>;

export function loadFacts(file: string): Facts {
  if (!fs.existsSync(file)) {
    throw new Error(
      `No facts file at ${file}. Copy facts.example.json to client/facts.json and fill it in ("not sure" is a fine answer).`,
    );
  }
  return FactsSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function isKnown<T>(v: T | "not sure"): v is T {
  return v !== "not sure" && v !== undefined && v !== null && v !== "";
}

export type OrderBy =
  | { status: "computed"; date: string; display: string; method: string; carrierAssumed: boolean }
  | { status: "blocked"; reason: string };

/** 2026 USPS Ground Advantage recommendation, from the ecommerce-holiday-email skill. Used only as a marked assumption. */
const SKILL_DEFAULT_CARRIER = { service: "USPS Ground Advantage", lastShipDate: "2026-12-17" };

/**
 * Store order-by date = carrier last-ship date − handling days − buffer (calendar days).
 * Never copied from a carrier: if handling time is unknown, it's BLOCKED.
 */
export function computeOrderBy(f: Facts): OrderBy {
  if (!isKnown(f.handlingDays)) {
    return { status: "blocked", reason: "Handling time (order → carrier) is unknown, so the order-by date can't be worked out." };
  }
  const carrierAssumed = !isKnown(f.carrier);
  const carrier = carrierAssumed ? SKILL_DEFAULT_CARRIER : (f.carrier as Exclude<Facts["carrier"], "not sure">);
  const d = new Date(`${carrier.lastShipDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - f.handlingDays - f.bufferDays);
  const date = d.toISOString().slice(0, 10);
  const display = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  return {
    status: "computed",
    date,
    display,
    carrierAssumed,
    method: `${carrier.service} last-ship ${carrier.lastShipDate} − ${f.handlingDays} handling day(s) − ${f.bufferDays} buffer day(s)${carrierAssumed ? " [ASSUMED carrier date from 2026 USPS guidance; confirm]" : ""}`,
  };
}

/** Which fact fields a claim may cite as its source. */
export function citableFacts(f: Facts): Record<string, string> {
  const out: Record<string, string> = {};
  f.inventoryNotes.forEach((n, i) => (out[`inventoryNotes[${i}]`] = n));
  f.proofPoints.forEach((n, i) => (out[`proofPoints[${i}]`] = n));
  f.drops.forEach((d, i) => (out[`drops[${i}]`] = `${d.collection} drops ${d.date} ${d.time}`));
  if (isKnown(f.offer) && f.offer !== "help me decide") out["offer"] = f.offer;
  return out;
}
