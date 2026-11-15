/**
 * Install the client's skills from their kit zip into ./.claude/skills (git-ignored).
 * The kit holds skills/<name>.zip files; each is unzipped as-is.
 *   npm run setup                      # finds *.zip with a skills/ folder in the client dir
 *   npm run setup -- path/to/kit.zip
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { AGENT_ROOT, config, GRADER_SKILLS, WRITER_SKILLS } from "../src/config.ts";

const dest = path.join(AGENT_ROOT, ".claude", "skills");
const unzipList = (zip: string) => execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" }).split("\n").filter(Boolean);

let kit = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!kit) {
  const candidates = fs.readdirSync(config.clientDir).filter((f) => f.endsWith(".zip")).map((f) => path.join(config.clientDir, f));
  kit = candidates.find((z) => unzipList(z).some((e) => /(^|\/)skills\/[^/]+\.zip$/.test(e))) ?? "";
}
if (!kit) {
  console.error(`No kit zip with a skills/ folder found in ${config.clientDir}. Pass one: npm run setup -- path/to/kit.zip`);
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "email-kit-"));
execFileSync("unzip", ["-oq", kit, "-d", tmp]);
const skillZips: string[] = [];
const walk = (d: string) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".zip") && skillZips.push(path.join(d, e.name))));
walk(tmp);

fs.mkdirSync(dest, { recursive: true });
for (const z of skillZips) execFileSync("unzip", ["-oq", z, "-d", dest]);
fs.rmSync(tmp, { recursive: true, force: true });

const installed = fs.readdirSync(dest).filter((d) => fs.existsSync(path.join(dest, d, "SKILL.md")));
console.log(`Installed ${installed.length} skill(s) into ${path.relative(process.cwd(), dest)}: ${installed.join(", ")}`);
const missing = [...WRITER_SKILLS, ...GRADER_SKILLS].filter((s) => !installed.includes(s));
if (missing.length) {
  console.error(`Missing skills the pipeline needs: ${missing.join(", ")}`);
  process.exit(1);
}
