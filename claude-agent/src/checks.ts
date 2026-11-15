import type { Campaign, Email, Fix, GateResult } from "./schema.ts";
import type { Catalog } from "./catalog.ts";
import { allSkus } from "./catalog.ts";
import type { Facts, OrderBy } from "./facts.ts";
import { citableFacts, isKnown } from "./facts.ts";

/**
 * Mechanical gates, run in code so they're repeatable and the grader can't talk its way past them.
 * The model grader judges voice, story and fit; these judge counts, patterns, dates and names.
 */
export type CheckResult = {
  scope: "campaign" | string; // email id
  gate: string;
  result: GateResult;
  evidence: string[];
};

export type CheckReport = { results: CheckResult[]; fixes: Fix[] };

const BANNED: { name: string; re: RegExp }[] = [
  { name: '"from this to that" construction', re: /(^|[.!?]\s+|\n)\s*from\s+[\w'’-]+(?:\s+[\w'’-]+){0,3}\s+to\s+[\w'’-]+/i },
  { name: '"it\'s not X, it\'s Y"', re: /\bit[’']?s not\b[^.!?]{1,60}\bit[’']?s\b/i },
  { name: '"not just X, but Y"', re: /\bnot just\b[^.!?]{1,60}\bbut\b/i },
  { name: '"no X, no Y, no Z" list', re: /\bno\s+[\w'’-]+,\s*no\s+[\w'’-]+,\s*(?:and\s+)?no\s+[\w'’-]+/i },
  { name: "self-answered question", re: /\b(?:the|and the)\s+(?:result|best part|secret|answer|catch|kicker|twist)\?/i },
  { name: '"say goodbye to"', re: /\bsay goodbye to\b/i },
  { name: '"unlock"', re: /\bunlock(?:s|ed|ing)?\b/i },
  { name: '"take it to the next level"', re: /\bnext level\b/i },
  { name: '"here\'s the thing"', re: /\bhere[’']?s the thing\b/i },
  { name: '"hope this email finds you"', re: /\bhope this (?:email|note) finds you\b/i },
  { name: '"just checking in"', re: /\bjust checking in\b/i },
  { name: '"feel free to reach out"', re: /\bfeel free to reach out\b/i },
];

/** Claims that need a source (C1). */
const BRAG = /\b(biggest (?:sale|deal)s? (?:of the year|ever)|best[- ]?sell(?:ing|er|ers)|most[- ]loved|fan[- ]favou?rites?|customer[- ]favou?rites?|softest ever|our softest|going fast|selling (?:fast|out)|thousands of (?:families|customers|happy)|\d[\d,]*\+?\s*(?:five|5)[- ]star|\d[\d,]*\+?\s*reviews|award[- ]winning)\b/gi;
/** Urgency that must be literally true (E1). */
const URGENCY = /\b(low stock|only \d+ left|almost gone|last chance|final hours|ends (?:tonight|today|soon)|running low|limited stock|won[’']t last|before it[’']s gone)\b/gi;

const TIME = /\b(\d{1,2}(?::\d{2})?\s?(?:AM|PM|a\.m\.|p\.m\.))/gi;
const TZ = /^\s*(?:ET|EST|EDT|PT|PST|PDT|CT|CST|CDT|MT|MST|MDT|Eastern|Pacific|Central|Mountain)\b/i;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const ORDER_BY = /\border(?:ed)?\s+by\s+(?:\w+day,?\s+)?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}|\d{1,2}\/\d{1,2})/gi;

const wordCount = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

export function emailText(e: Email): string {
  return [
    ...e.subjectOptions.map((s) => s.text),
    e.preview,
    e.headline,
    e.subcopy,
    ...e.body.map((b) => b.copy),
    ...e.ctas.map((c) => c.text),
  ].join("\n");
}

function monthDay(raw: string): string | null {
  const s = raw.toLowerCase().replace(/\./g, "").trim();
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slash) return `${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  const m = s.match(/^([a-z]+)\s+(\d{1,2})$/);
  if (!m) return null;
  const idx = MONTHS.findIndex((mo) => mo.startsWith(m[1].slice(0, 3)));
  return idx < 0 ? null : `${String(idx + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

function push(results: CheckResult[], fixes: Fix[], r: CheckResult, fix?: Omit<Fix, "type"> & { type?: Fix["type"] }) {
  results.push(r);
  if (fix && r.result !== "pass") fixes.push({ type: "fix_now", ...fix } as Fix);
}

export function runChecks(c: Campaign, facts: Facts, orderBy: OrderBy, catalog: Catalog): CheckReport {
  const results: CheckResult[] = [];
  const fixes: Fix[] = [];
  const specs = c.emails.filter((e) => e.status === "spec");
  const collectionNames = new Map(catalog.collections.map((x) => [x.name.toLowerCase(), x.name]));
  const skus = allSkus(catalog);
  const sources = citableFacts(facts);
  if (orderBy.status === "computed") sources["orderBy"] = orderBy.date;
  const [hMin, hMax] = facts.brandRules.headlineWords;
  const [cMin, cMax] = facts.brandRules.ctaCount;

  /* ── C2 Dates: one computed order-by date, everywhere; every time has a time zone ── */
  {
    const evidence: string[] = [];
    let result: GateResult = "pass";
    const expected = orderBy.status === "computed" ? orderBy.date.slice(5) : null;
    for (const e of specs) {
      const text = emailText(e);
      for (const m of text.matchAll(ORDER_BY)) {
        const md = monthDay(m[1]);
        if (!expected) {
          result = "fail";
          evidence.push(`${e.id}: says "${m[0]}" but the order-by date can't be computed yet (${(orderBy as { reason: string }).reason}). Use [NEED: order-by date].`);
        } else if (md && md !== expected) {
          result = "fail";
          evidence.push(`${e.id}: says "${m[0]}", but the computed order-by date is ${orderBy.status === "computed" ? orderBy.display : ""}.`);
        }
      }
      if (/\bmidnight\b/i.test(text)) {
        result = "fail";
        evidence.push(`${e.id}: says "midnight". Use an exact time and zone, e.g. "11:59 PM ET".`);
      }
      for (const m of text.matchAll(TIME)) {
        const after = text.slice((m.index ?? 0) + m[0].length);
        if (!TZ.test(after)) {
          result = "fail";
          evidence.push(`${e.id}: "${m[0]}" has no time zone.`);
        }
      }
      if (!e.sendTime || !e.timezone || !/^\d{4}-\d{2}-\d{2}$/.test(e.sendDate)) {
        result = "fail";
        evidence.push(`${e.id}: send date/time/zone incomplete (${e.sendDate} ${e.sendTime} ${e.timezone}).`);
      }
    }
    if (result === "pass" && !expected) {
      const mentions = specs.some((e) => /\[NEED:[^\]]*order[- ]by/i.test(emailText(e)));
      result = mentions || c.type === "season_plan" ? "blocked" : "pass";
      evidence.push(`Order-by date not computable: ${(orderBy as { reason: string }).reason}`);
    }
    if (result === "pass") evidence.push(expected ? `Every order-by mention matches ${orderBy.status === "computed" ? orderBy.display : ""}; all times carry a zone.` : "No order-by date mentioned; all times carry a zone.");
    push(results, fixes, { scope: "campaign", gate: "C2", result, evidence }, { where: "Campaign: dates", change: evidence.join(" "), points: 10 });
  }

  /* ── C4 Real products: every featured collection and SKU exists ── */
  {
    const evidence: string[] = [];
    for (const e of c.emails) {
      for (const name of e.collections) if (!collectionNames.has(name.toLowerCase().trim())) evidence.push(`${e.id}: collection "${name}" is not in the catalog.`);
      for (const s of e.skus) if (!skus.has(s.trim())) evidence.push(`${e.id}: SKU "${s}" is not in the catalog.`);
    }
    const result: GateResult = evidence.length ? "fail" : "pass";
    if (!evidence.length) evidence.push("All featured collections and SKUs match the catalog.");
    push(results, fixes, { scope: "campaign", gate: "C4", result, evidence }, { where: "Campaign: product names", change: `Use catalog names only. ${evidence.join(" ")}`, points: 8 });
  }

  /* ── C6 Complete specs ── */
  {
    const evidence: string[] = [];
    for (const e of specs) {
      const missing = [
        ["segment", e.segment],
        ["goal", e.goal],
        ["why", e.why],
        ["preview", e.preview],
        ["headline", e.headline],
        ["subcopy", e.subcopy],
        ["exclusions", e.exclusions],
      ]
        .filter(([, v]) => !String(v ?? "").trim())
        .map(([k]) => k);
      if (!e.subjectOptions.length) missing.push("subject options");
      if (!e.body.length) missing.push("body");
      if (!e.ctas.length) missing.push("CTA");
      if (missing.length) evidence.push(`${e.id}: missing ${missing.join(", ")}.`);
    }
    const calendarIds = new Set(c.calendar.map((r) => r.emailId));
    for (const e of c.emails) if (!calendarIds.has(e.id)) evidence.push(`${e.id} is not on the calendar.`);
    const result: GateResult = evidence.length ? "fail" : "pass";
    if (!evidence.length) evidence.push(`All ${specs.length} specs have every field.`);
    push(results, fixes, { scope: "campaign", gate: "C6", result, evidence }, { where: "Campaign: specs", change: `Fill in: ${evidence.join(" ")}`, points: 4 });
  }

  /* ── C1 Truth (campaign) + E1 Truthful urgency (per email): every claim has a valid source ── */
  const c1: string[] = [];
  let c1Blocked = false;
  for (const e of specs) {
    const text = emailText(e);
    const declared = e.claims.map((cl) => ({ ...cl, t: cl.text.toLowerCase() }));
    const validSource = (src: string) => src === "NEED" || src in sources;
    const check = (re: RegExp, bucket: string[], urgency: boolean) => {
      for (const m of text.matchAll(re)) {
        const phrase = m[0].toLowerCase();
        const claim = declared.find((d) => d.t.includes(phrase) || phrase.includes(d.t));
        const lineHasNeed = new RegExp(`${escapeRe(m[0])}[^\\n]{0,80}\\[NEED:|\\[NEED:[^\\]]*\\][^\\n]{0,80}${escapeRe(m[0])}`, "i").test(text);
        if (!claim) bucket.push(`${e.id}: "${m[0]}" has no declared source.`);
        else if (!validSource(claim.source)) bucket.push(`${e.id}: "${m[0]}" cites "${claim.source}", which isn't in the facts.`);
        else if (claim.source === "NEED" && !lineHasNeed) bucket.push(`${e.id}: "${m[0]}" is unsourced and not marked [NEED: ...] in the copy.`);
        else if (claim.source === "NEED") c1Blocked = true;
        if (urgency && claim?.source.startsWith("proofPoints")) bucket.push(`${e.id}: urgency "${m[0]}" must come from inventory, a drop, the offer end or the order-by date.`);
      }
    };
    check(BRAG, c1, false);
    const e1: string[] = [];
    check(URGENCY, e1, true);
    const e1Result: GateResult = e1.length ? "fail" : "pass";
    push(results, fixes, { scope: e.id, gate: "E1", result: e1Result, evidence: e1.length ? e1 : ["Urgency lines are sourced (or there are none)."] }, { where: `${e.id}: urgency`, change: `Remove or source: ${e1.join(" ")}`, points: 8 });

    /* E2 headline length */
    const n = wordCount(e.headline);
    push(
      results,
      fixes,
      { scope: e.id, gate: "E2", result: n >= hMin && n <= hMax ? "pass" : "fail", evidence: [`"${e.headline}" is ${n} words (rule ${hMin}–${hMax}).`] },
      { where: `${e.id}: headline`, change: `Rewrite "${e.headline}" (${n} words) to ${hMin}–${hMax} words, keeping the theme.`, points: 3 },
    );

    /* E3 CTA count */
    push(
      results,
      fixes,
      { scope: e.id, gate: "E3", result: e.ctas.length >= cMin && e.ctas.length <= cMax ? "pass" : "fail", evidence: [`${e.ctas.length} CTA(s): ${e.ctas.map((x) => `"${x.text}"`).join(", ")} (rule ${cMin}–${cMax}).`] },
      { where: `${e.id}: CTAs`, change: `Use ${cMin}–${cMax} CTAs; keep the most specific one.`, points: 3 },
    );

    /* E4 banned patterns + em dashes in subject/preview */
    const hits: string[] = [];
    for (const b of BANNED) {
      const m = text.match(b.re);
      if (m) hits.push(`${b.name}: "${m[0].trim()}"`);
    }
    for (const s of [...e.subjectOptions.map((x) => x.text), e.preview]) if (/[—–]/.test(s)) hits.push(`dash in subject/preview: "${s}"`);
    push(
      results,
      fixes,
      { scope: e.id, gate: "E4", result: hits.length ? "fail" : "pass", evidence: hits.length ? hits : ["No banned patterns."] },
      { where: `${e.id}: copy`, change: `Rewrite to remove: ${hits.join("; ")}`, points: 3 },
    );
  }
  const c1Result: GateResult = c1.length ? "fail" : c1Blocked ? "blocked" : "pass";
  push(
    results,
    fixes,
    { scope: "campaign", gate: "C1", result: c1Result, evidence: c1.length ? c1 : [c1Blocked ? "Claims needing proof are marked [NEED]." : "Every claim cites a fact (or there are none)."] },
    { where: "Campaign: claims", change: `Cite a facts key, or cut the claim, or mark it [NEED: ...] and set its source to NEED. ${c1.join(" ")}`, points: 10 },
  );

  /* ── C3 Offer: if undecided, the copy must not state a deal ── */
  if (!isKnown(facts.offer) || /help me decide/i.test(facts.offer)) {
    const dealy = /\b\d{1,2}\s?% off\b|\bfree shipping\b|\bgift with purchase\b|\bspend \$\d+/i;
    const stated = specs.filter((e) => dealy.test(emailText(e)) && !/\[NEED:[^\]]*offer/i.test(emailText(e)));
    push(
      results,
      fixes,
      {
        scope: "campaign",
        gate: "C3",
        result: stated.length ? "fail" : "blocked",
        evidence: stated.length
          ? stated.map((e) => `${e.id} states a deal ("${emailText(e).match(dealy)?.[0]}") but no offer has been decided.`)
          : ["Offer not decided yet; copy holds the slot with [NEED: offer]."],
      },
      { where: "Campaign: offer", change: "Don't state a deal until the client picks one; write [NEED: offer] and keep the copy offer-agnostic.", points: 8 },
    );
  }

  return { results, fixes };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** All [NEED: ...] markers in the campaign. */
export function needMarkers(c: Campaign): string[] {
  const all = JSON.stringify(c);
  return [...new Set([...all.matchAll(/\[NEED:\s*([^\]]+)\]/g)].map((m) => m[1].trim()))];
}
