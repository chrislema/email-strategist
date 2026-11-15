import { test } from "node:test";
import assert from "node:assert/strict";
import { runChecks } from "../src/lib/checks";
import { computeOrderBy, FactsSchema } from "../src/lib/facts";
import { buildScorecard } from "../src/lib/score";
import type { Catalog } from "../src/lib/catalog";
import type { Campaign, Email, Review } from "../src/lib/schema";

// Fictional brand data only: this repo is public.
const catalog: Catalog = {
  clientDir: "/tmp/x",
  brandGuidePdf: null,
  logos: [],
  collections: [{ code: "900", name: "Moonlight Meadow", folder: "/tmp/x/900", skus: ["PJ-900", "PET-900"], images: [] }],
  photoFolders: [],
};
const facts = FactsSchema.parse({ brand: "Test Co", handlingDays: 1, carrier: { service: "USPS Ground Advantage", lastShipDate: "2026-12-17" }, offer: "Free shipping over $75" });
const orderBy = computeOrderBy(facts);

const good: Email = {
  id: "E1",
  name: "Drop Day",
  status: "spec",
  segment: "Engaged",
  sendDate: "2026-12-01",
  sendTime: "10:14 AM",
  timezone: "ET",
  goal: "Shop the drop",
  why: "Drop goes live now.",
  subjectOptions: [{ text: "Moonlight Meadow is here", why: "names the print" }],
  preview: "Matching pajamas for the whole family, and the dog",
  headline: "Drift Into a Meadow Christmas",
  subcopy: "Our Moonlight Meadow print just landed. Order by December 15 for Christmas.",
  body: [{ section: "Hero", copy: "Soft bamboo for every sleepy head, free shipping over $75.", image: "" }],
  ctas: [{ text: "Shop the Collection", destination: "/moonlight-meadow" }],
  exclusions: "Bought in the last 24 hours",
  collections: ["Moonlight Meadow"],
  skus: ["PJ-900"],
  claims: [],
};
const campaign = (emails: Email[]): Campaign => ({
  title: "Test",
  type: "drop_launch",
  summary: "",
  calendar: emails.map((e) => ({ emailId: e.id, date: e.sendDate, time: e.sendTime, timezone: e.timezone, segment: e.segment, emailName: e.name, goal: e.goal, offer: "" })),
  segmentVolumes: [],
  flowChanges: [],
  emails,
  assumptions: [],
  needs: [],
  openDecisions: [],
});
const gate = (r: ReturnType<typeof runChecks>, scope: string, g: string) => r.results.find((x) => x.scope === scope && x.gate === g)?.result;

test("order-by = carrier date − handling − buffer", () => {
  assert.equal(orderBy.status, "computed");
  assert.equal(orderBy.status === "computed" && orderBy.date, "2026-12-15");
  assert.equal(computeOrderBy(FactsSchema.parse({ brand: "x" })).status, "blocked");
});

test("a clean email passes every code gate", () => {
  const r = runChecks(campaign([good]), facts, orderBy, catalog);
  for (const x of r.results) assert.equal(x.result, "pass", `${x.scope}/${x.gate}: ${x.evidence.join(" ")}`);
});

test("the review skill's failing calibration example fails the right gates", () => {
  const bad: Email = {
    ...good,
    subjectOptions: [{ text: "You won't believe these deals!!", why: "" }],
    headline: "Huge Black Friday Savings On All Of Our Amazing Holiday Pajamas",
    body: [{ section: "Hero", copy: "From cozy nights to festive mornings… Only 3 left! Our best-selling print.", image: "" }],
    ctas: ["Shop Now", "Shop Women", "Shop Kids", "Shop Pets"].map((text) => ({ text, destination: "/" })),
  };
  const r = runChecks(campaign([bad]), facts, orderBy, catalog);
  assert.equal(gate(r, "E1", "E1"), "fail"); // "Only 3 left" has no inventory source
  assert.equal(gate(r, "E1", "E2"), "fail"); // 10-word headline
  assert.equal(gate(r, "E1", "E3"), "fail"); // 4 CTAs
  assert.equal(gate(r, "E1", "E4"), "fail"); // "From cozy nights to festive mornings"
  assert.equal(gate(r, "campaign", "C1"), "fail"); // "best-selling" unsourced
});

test("a wrong order-by date, a bare 'midnight' or a time without a zone fails C2", () => {
  const wrong = { ...good, subcopy: "Order by Dec 16 for Christmas." };
  assert.equal(gate(runChecks(campaign([wrong]), facts, orderBy, catalog), "campaign", "C2"), "fail");
  const midnight = { ...good, subcopy: "The sale ends at midnight." };
  assert.equal(gate(runChecks(campaign([midnight]), facts, orderBy, catalog), "campaign", "C2"), "fail");
  const noZone = { ...good, subcopy: "Drops at 11 AM sharp." };
  assert.equal(gate(runChecks(campaign([noZone]), facts, orderBy, catalog), "campaign", "C2"), "fail");
});

test("invented products fail C4", () => {
  const invented = { ...good, collections: ["Starlight Sleigh"], skus: ["PJ-999"] };
  assert.equal(gate(runChecks(campaign([invented]), facts, orderBy, catalog), "campaign", "C4"), "fail");
});

test("claims sourced from facts pass; [NEED] claims make C1 blocked, not failed", () => {
  const f2 = FactsSchema.parse({ ...facts, inventoryNotes: ["PET-900 has under 40 units"], proofPoints: [] });
  const sourced = { ...good, subcopy: "Pet sizes are running low.", claims: [{ text: "running low", source: "inventoryNotes[0]" }] };
  assert.equal(gate(runChecks(campaign([sourced]), f2, orderBy, catalog), "E1", "E1"), "pass");
  const need = { ...good, subcopy: "Our best-selling print [NEED: sales fact for best-selling].", claims: [{ text: "best-selling", source: "NEED" }] };
  assert.equal(gate(runChecks(campaign([need]), facts, orderBy, catalog), "campaign", "C1"), "blocked");
});

test("undecided offer: stating a deal fails C3, holding the slot is blocked", () => {
  const undecided = FactsSchema.parse({ ...facts, offer: "help me decide" });
  assert.equal(gate(runChecks(campaign([good]), undecided, orderBy, catalog), "campaign", "C3"), "fail");
  const held = { ...good, body: [{ section: "Hero", copy: "Something special is coming [NEED: offer].", image: "" }] };
  assert.equal(gate(runChecks(campaign([held]), undecided, orderBy, catalog), "campaign", "C3"), "blocked");
});

test("scorecard: grader can't pass a gate the code failed; blocked-only work is READY PENDING FACTS", () => {
  const fives = (dims: string[]) => dims.map((d) => ({ dimension: d, score: 5, quote: "q" }));
  const review = (gateResult: "pass" | "blocked"): Review => ({
    campaignGates: (["C1", "C2", "C3", "C4", "C5", "C6"] as const).map((g) => ({ gate: g, result: g === "C3" ? gateResult : "pass", quote: "", note: "" })),
    campaignScores: fives(["calendar_coverage", "segments_and_volume", "variety_and_arc", "offer_and_flows", "client_ready"]) as Review["campaignScores"],
    emails: [{ emailId: "E1", gates: (["E1", "E2", "E3", "E4"] as const).map((g) => ({ gate: g, result: "pass", quote: "", note: "" })), scores: fives(["brand_voice", "one_job_one_path", "subject_and_preview", "story_top_to_bottom", "buyer_and_gift_angle", "specific_not_generic"]) as Review["emails"][0]["scores"] }],
    fixes: [],
    stillWeak: "",
  });
  const c = campaign([good]);
  assert.equal(buildScorecard(c, runChecks(c, facts, orderBy, catalog), review("pass")).status, "CLIENT-READY");

  const bad = campaign([{ ...good, headline: "Way Too Many Words In This One Headline Today" }]);
  const s = buildScorecard(bad, runChecks(bad, facts, orderBy, catalog), review("pass"));
  assert.equal(s.status, "NOT YET");
  assert.ok(s.items[1].pct <= 60, "minor gate fail caps at 60%");

  const undecided = FactsSchema.parse({ ...facts, offer: "help me decide" });
  const held = campaign([{ ...good, body: [{ section: "Hero", copy: "Something special is coming [NEED: offer].", image: "" }] }]);
  assert.equal(buildScorecard(held, runChecks(held, undecided, orderBy, catalog), review("blocked")).status, "READY PENDING FACTS");
});

test("questions answered right away fail E4 (same line only; a question subject followed by a preview is fine)", () => {
  const q = { ...good, body: [{ section: "Help", copy: "Between sizes? Size up for room to grow.", image: "" }] };
  assert.equal(gate(runChecks(campaign([q]), facts, orderBy, catalog), "E1", "E4"), "fail");
  const subj = { ...good, subjectOptions: [{ text: "Ready for snow?", why: "" }] };
  assert.equal(gate(runChecks(campaign([subj]), facts, orderBy, catalog), "E1", "E4"), "pass");
});

test("blocked gates never become Fix Now items", () => {
  const undecided = FactsSchema.parse({ ...facts, offer: "help me decide", handlingDays: "not sure" });
  const held = { ...good, subcopy: "Our print just landed. Order by [NEED: order-by date] for Christmas.", body: [{ section: "Hero", copy: "Something special is coming [NEED: offer].", image: "" }] };
  const r = runChecks({ ...campaign([held]), type: "season_plan" }, undecided, computeOrderBy(undecided), catalog);
  assert.equal(gate(r, "campaign", "C2"), "blocked");
  assert.equal(gate(r, "campaign", "C3"), "blocked");
  assert.deepEqual(r.fixes.filter((f) => /dates|offer/.test(f.where)), []);
});
