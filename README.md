# Email Strategist

One job, built twice so the two approaches can be compared side by side: take a campaign idea, read the client's
brand guide and product assets, write the email sequence, grade it with an independent reviewer, fix what's
flagged, and present it only once it clears the bar (or hand back the list of facts it still needs).

| Folder | Built on | Status |
|---|---|---|
| [`claude-agent/`](claude-agent/) | Claude Agent SDK | v0.1 |
| [`mastra-agent/`](mastra-agent/) | Mastra | next |

## Customer data

This repo is public. Client materials (brand guides, logos, product images, kits, facts files) and every generated
campaign stay in this folder on disk and are **never committed**. The root `.gitignore` is an allowlist: only the
code folders are tracked.
