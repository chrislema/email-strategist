# Email Strategist · Mastra build

The same job as [`../claude-agent`](../claude-agent), built as a Mastra workflow with two Mastra agents.
The code gates, scoring math, reports and status rules are identical (`src/lib/` is shared logic, copied), so
the two builds grade by exactly the same rules. What differs is the harness.

```
campaign-workflow
  intake-and-draft ─▶ dountil( check-grade-fix , done ) ─▶ present
        │                      │
   campaignWriter     code checks → campaignGrader → scorecard (code) → campaignWriter fixes
```

## How it differs from the Agent SDK build

| | Agent SDK build | This build |
|---|---|---|
| Loop | Plain TypeScript `for` loop | Mastra workflow: `.then(draft).dountil(round, done).then(present)` |
| Skills | Loaded by the Claude Code harness | Loaded from disk per agent (`skills: [path]`), writer and grader each get only their own |
| Reading the brand guide and brief | Agent reads files with Read/Glob/Grep | Code puts the brief and brand-guide text into the prompt |
| Product images | Writer browses and picks up to 6 | Code picks one hero per collection, shrinks it, attaches it |
| Hiding the rubric from the writer | A hook blocks file reads | The writer agent never has the review skill attached |
| Auth | Claude Code login or API key | **`ANTHROPIC_API_KEY` required** |
| Inspecting runs | Files in `runs/` | Files in `runs/`, plus Mastra Studio (`npm run dev`) |
| Models | Claude only | Any Mastra model-router id (`provider/model`) |

## Setup

```bash
npm install
npm run setup                              # installs the skills from the client's kit zip into .claude/skills (git-ignored)
cp facts.example.json client/facts.json    # fill in what you know; "not sure" is fine
cp .env.example .env                       # add ANTHROPIC_API_KEY
```

Client materials live next to this folder by default (`../resources/`, `../Client Shared Assets/`).
Override with `EMAIL_CLIENT_DIR`, `EMAIL_RESOURCES_DIR`, `EMAIL_ASSETS_DIR`. None of it is ever committed.

## Run

```bash
npm run campaign -- "Plan the <collection> drop: tease, drop day, deep dive. Drop is Dec 3 at 11 AM ET."
npm run campaign -- "<idea>" --dry-run      # intake only: brief + order-by date, no model calls
npm run dev                                 # Mastra Studio at http://localhost:4111: run the workflow, inspect each step
npm test                                    # code-gate tests
```

Output goes to `runs/<timestamp>-<idea>/` with the same layout as the Agent SDK build (`round-N/`, `final/`), plus
`images/` with the hero images that were attached.

Statuses (`CLIENT-READY`, `READY PENDING FACTS`, `NOT YET`, `NOT DELIVERABLE`) and the bar are the same as in the
Agent SDK build. See its README.

## Settings (env)

| Var | Default |
|---|---|
| `ANTHROPIC_API_KEY` | required |
| `EMAIL_WRITER_MODEL` / `EMAIL_GRADER_MODEL` | `anthropic/claude-opus-5-5` |
| `EMAIL_WRITER_EFFORT` / `EMAIL_GRADER_EFFORT` | `high` |
| `EMAIL_MAX_ROUNDS` | `3` |
| `EMAIL_MAX_OUTPUT_TOKENS` | `64000` |
| `EMAIL_MAX_IMAGES` | `6` |

Storage is in-memory (Mastra's default), so Studio history resets on restart. Add `@mastra/libsql` to keep it.
