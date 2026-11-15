import { parseArgs } from "node:util";
import path from "node:path";
import { mastra } from "./mastra/index";
import { buildBrief } from "./lib/brief";
import { config } from "./lib/config";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    facts: { type: "string" },
    rounds: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const idea = positionals.join(" ").trim();
if (values.help || !idea) {
  console.log(`Usage: npm run campaign -- "<idea>" [--facts client/facts.json] [--rounds 3] [--dry-run]

  "<idea>"     What to build, e.g. "Plan the <collection> drop: tease, drop day, deep dive"
  --facts      Client facts file (default ${path.relative(process.cwd(), config.factsPath)})
  --rounds     Max grade/fix rounds (default ${config.maxRounds})
  --dry-run    Intake only: build the brief, compute the order-by date, no model calls

Needs ANTHROPIC_API_KEY (in .env). Models: EMAIL_WRITER_MODEL / EMAIL_GRADER_MODEL (default ${config.writerModel})`);
  process.exit(idea ? 0 : 1);
}

const factsPath = values.facts ? path.resolve(values.facts) : undefined;

if (values["dry-run"]) {
  const b = buildBrief(idea, factsPath);
  console.log(`Brief written: ${b.briefPath}`);
  console.log(`Order-by: ${b.orderBy.status === "computed" ? `${b.orderBy.display} · ${b.orderBy.method}` : `BLOCKED · ${b.orderBy.reason}`}`);
  console.log(`Collections: ${b.catalog.collections.map((c) => c.name).join(", ")}`);
  process.exit(0);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("✗ ANTHROPIC_API_KEY is not set. Mastra calls the API directly (it can't use a Claude Code login). Add it to mastra-agent/.env.");
  process.exit(1);
}

const run = await mastra.getWorkflow("campaignWorkflow").createRun();
const result = await run.start({ inputData: { idea, factsPath, maxRounds: values.rounds ? Number(values.rounds) : undefined } });

if (result.status !== "success") {
  const err = "error" in result ? (result.error as Error)?.message ?? String(result.error) : result.status;
  console.error(`\n✗ Workflow ${result.status}: ${err}`);
  process.exit(1);
}
const r = result.result;
const verdict =
  r.status === "CLIENT-READY"
    ? "This is ready to send to the client."
    : r.status === "READY PENDING FACTS"
      ? "Finished everything it could. It's ready once the facts in needs.md come back."
      : "Not ready yet. See the scorecard for what's still weak.";
console.log(`
══════════════════════════════════════════
 ${r.status} · ${r.overallPct}%  (${r.history.map((p, i) => `R${i + 1} ${p}%`).join(" → ")})
 ${r.stopReason}
 ${verdict}
──────────────────────────────────────────
 Campaign:  ${r.files.campaign}
 Scorecard: ${r.files.scorecard}
 Needs:     ${r.files.needs}
 Cost:      ${r.files.cost}
 Est. cost: $${r.usage.costUsd.toFixed(2)} · ${r.usage.calls} calls · ${r.usage.steps} steps · ${r.usage.cacheRead.toLocaleString()} cache read / ${r.usage.cacheWrite.toLocaleString()} cache write / ${r.usage.input.toLocaleString()} in / ${r.usage.output.toLocaleString()} out
══════════════════════════════════════════`);
process.exit(0);
