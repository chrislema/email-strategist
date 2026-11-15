import fs from "node:fs";
import path from "node:path";
import { config } from "./config";
import { buildCatalog, catalogSummary, extractBrandGuide, type Catalog } from "./catalog";
import { computeOrderBy, loadFacts, type Facts, type OrderBy } from "./facts";

export type Brief = {
  runDir: string;
  briefPath: string;
  brandGuidePath: string | null;
  assetsDir: string;
  readableDirs: string[];
  today: string;
  facts: Facts;
  orderBy: OrderBy;
  catalog: Catalog;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** Intake: load facts, compute the order-by date, build the catalog, write the brief both agents read. No model calls. */
export function buildBrief(idea: string, factsPath = config.factsPath): Brief {
  const facts = loadFacts(factsPath);
  const orderBy = computeOrderBy(facts);
  const catalog = buildCatalog();
  if (!catalog.collections.length) {
    throw new Error(`No collection folders found in ${path.join(config.clientDir, config.assetsDir)}. Set EMAIL_CLIENT_DIR / EMAIL_ASSETS_DIR.`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.join(config.runsDir, `${stamp}-${slug(idea)}`);
  fs.mkdirSync(runDir, { recursive: true });

  const brandGuidePath = extractBrandGuide(catalog, runDir);
  const today = new Date().toISOString().slice(0, 10);
  const featured = facts.collections.length ? facts.collections : catalog.collections.map((c) => c.name);

  const md = [
    `# Campaign brief`,
    ``,
    `Idea: ${idea}`,
    `Brand: ${facts.brand}`,
    `Today: ${today}`,
    ``,
    `## Order-by date (computed, use exactly)`,
    orderBy.status === "computed" ? `${orderBy.display} (${orderBy.date}). Method: ${orderBy.method}` : `BLOCKED: ${orderBy.reason} Write [NEED: order-by date].`,
    ``,
    `## Facts from the client ("not sure" = unknown: assume and mark, or [NEED])`,
    "```json",
    JSON.stringify(facts, null, 2),
    "```",
    ``,
    `Citable claim sources: inventoryNotes[i], proofPoints[i], drops[i], offer${orderBy.status === "computed" ? ", orderBy" : ""}. Nothing else backs a claim.`,
    ``,
    `## Collections to feature`,
    featured.map((n) => `- ${n}`).join("\n"),
    ``,
    `## Catalog (from the client's asset folders)`,
    catalogSummary(catalog, facts.skuTypes),
    ``,
    `## Brand files`,
    `- Brand guide: ${brandGuidePath ?? "none found"}`,
    ...catalog.logos.map((l) => `- Logo: ${l}`),
  ].join("\n");

  const briefPath = path.join(runDir, "brief.md");
  fs.writeFileSync(briefPath, md);
  fs.writeFileSync(path.join(runDir, "intake.json"), JSON.stringify({ idea, facts, orderBy, catalog }, null, 2));

  const assetsDir = path.join(config.clientDir, config.assetsDir);
  return {
    runDir,
    briefPath,
    brandGuidePath,
    assetsDir,
    readableDirs: [runDir, assetsDir, path.join(config.clientDir, config.resourcesDir)],
    today,
    facts,
    orderBy,
    catalog,
  };
}
