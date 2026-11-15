# Email Strategist · Claude Agent SDK build

Idea in, graded email campaign out. A writer agent plans and writes the campaign from the client's brand guide and
asset folders. Code checks the mechanical rules. A separate grader agent scores it with the review rubric. The
writer fixes only what was flagged. Nothing is presented until the loop ends.

```
idea ─▶ intake (code) ─▶ writer ─▶ code checks ─▶ grader ─▶ scorecard (code) ─┬─▶ present
                                     ▲                                       │
                                     └──────────── writer fixes ◀────────────┘   (max 3 rounds)
```

## How it decides it's done

| Status | Meaning |
|---|---|
| **CLIENT-READY** | Every gate passes, overall ≥ 80%, no dimension below 3. |
| **READY PENDING FACTS** | Cleared the bar on everything it could. The rest is blocked on client-only facts (offer, handling time, inventory), marked `[NEED: …]` and listed in `needs.md`. |
| **NOT YET** | Still below the bar after the round cap, or nothing left the writer can fix. |
| **NOT DELIVERABLE** | A critical gate failed (made-up claim, wrong date, invented product). |

It never invents a fact to pass a gate. A missing fact is **blocked**, not failed, and goes on the list.

## Who decides what

- **Code (`src/checks.ts`) is authoritative** for headline length, CTA count, banned patterns, em dashes in subjects,
  the computed order-by date everywhere, time zones on every deadline, catalog names and SKUs, complete specs, and
  whether every claim cites a fact. The grader can fail a gate the code passed, but it can never pass a gate the code failed.
- **The grader** judges voice, story, gift angle, variety, segments and client-readiness, and quotes the line behind each score.
  It runs in a fresh context and never sees the writer's reasoning.
- **The writer** never sees the rubric. A hook blocks it from reading the review skill, and it only receives the fix list.
- **The math** (weighted %, the 60% cap on minor-gate failures, the bar) is computed in `src/score.ts`, not by a model.

## Setup

```bash
npm install
npm run setup                          # installs the skills from the client's kit zip into .claude/skills (git-ignored)
cp facts.example.json client/facts.json   # fill in what you know; "not sure" is fine
```

Client materials live next to this folder by default (`../resources/`, `../Client Shared Assets/`).
Override with `EMAIL_CLIENT_DIR`, `EMAIL_RESOURCES_DIR` and `EMAIL_ASSETS_DIR`. None of it is ever committed.

Auth: uses your Claude Code login, or `ANTHROPIC_API_KEY` if set.

## Run

```bash
npm run campaign -- "Plan the <collection> drop: tease, drop day, deep dive. Drop is Dec 3 at 11 AM ET."
npm run campaign -- "Build the Black Friday through Christmas plan" --rounds 3
npm run campaign -- "<idea>" --dry-run      # intake only: brief + order-by date, no model calls
npm run check -- runs/<run>/round-2         # re-run the code gates on a saved round
npm test                                    # code-gate tests
```

Each run writes `runs/<timestamp>-<idea>/` (git-ignored):

```
brief.md, brand-guide.txt, intake.json
round-N/  campaign.json · campaign.md · checks.json · review.json · scorecard.md
final/    campaign.md · scorecard.md · needs.md · campaign.json · summary.json
```

## Settings (env)

| Var | Default |
|---|---|
| `EMAIL_WRITER_MODEL` / `EMAIL_GRADER_MODEL` | `claude-opus-5-5` |
| `EMAIL_WRITER_EFFORT` / `EMAIL_GRADER_EFFORT` | `high` |
| `EMAIL_MAX_ROUNDS` | `3` |
| `EMAIL_BUDGET_PER_CALL_USD` | `10` (hard stop per agent call) |
| `EMAIL_FACTS` | `client/facts.json` |

## Layout

```
src/
  cli.ts            entry point
  pipeline.ts       the loop: draft → check → grade → score → fix → present
  brief.ts          intake: facts, order-by date, catalog, brand guide text
  facts.ts          facts schema + order-by computation
  catalog.ts        collections and SKUs from the asset folders (names never invented)
  checks.ts         deterministic gates
  score.ts          gate merge, weighted scoring, status
  report.ts         campaign.md, scorecard.md, needs.md
  schema.ts         campaign + review contracts (zod → JSON schema for structured output)
  agents/run.ts     query() wrapper: read-only tools, project-only settings, structured output
  agents/writer.ts  draft + revise
  agents/grader.ts  independent review
scripts/install-skills.ts
test/checks.test.ts
```

Saving drafts to the email platform isn't wired in yet. A human still reviews in the platform and sends.
