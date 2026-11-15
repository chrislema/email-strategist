/** Re-run the code checks on a saved campaign: npm run check -- runs/<run>/round-1 */
import fs from "node:fs";
import path from "node:path";
import { runChecks } from "./checks.ts";
import { CampaignSchema } from "./schema.ts";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: npm run check -- <run>/round-N   (folder holding campaign.json; intake.json is read from its parent)");
  process.exit(1);
}
const campaign = CampaignSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, "campaign.json"), "utf8")));
const intake = JSON.parse(fs.readFileSync(path.join(dir, "..", "intake.json"), "utf8"));
const { results } = runChecks(campaign, intake.facts, intake.orderBy, intake.catalog);
for (const r of results) console.log(`${r.result === "pass" ? "✓" : r.result === "blocked" ? "⏸" : "✗"} ${r.scope}/${r.gate}: ${r.evidence.join(" ")}`);
process.exit(results.some((r) => r.result === "fail") ? 2 : 0);
