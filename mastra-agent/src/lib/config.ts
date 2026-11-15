import fs from "node:fs";
import path from "node:path";

/**
 * Find mastra-agent/ by walking up from the working directory. (`mastra dev` bundles code into
 * .mastra/output, so paths derived from import.meta.url would point at the bundle, not the project.)
 */
function findAgentRoot(): string {
  if (process.env.EMAIL_AGENT_ROOT) return path.resolve(process.env.EMAIL_AGENT_ROOT);
  let dir = process.cwd();
  for (;;) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg) && JSON.parse(fs.readFileSync(pkg, "utf8")).name === "email-strategist-mastra-agent") return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Run from inside mastra-agent/ (or set EMAIL_AGENT_ROOT).");
    dir = parent;
  }
}

export const AGENT_ROOT = findAgentRoot();
export const REPO_ROOT = path.resolve(AGENT_ROOT, "..");
type Effort = "low" | "medium" | "high" | "xhigh" | "max";
const env = process.env;

export const config = {
  clientDir: path.resolve(env.EMAIL_CLIENT_DIR ?? REPO_ROOT),
  resourcesDir: env.EMAIL_RESOURCES_DIR ?? "resources",
  assetsDir: env.EMAIL_ASSETS_DIR ?? "Client Shared Assets",
  factsPath: path.resolve(AGENT_ROOT, env.EMAIL_FACTS ?? "client/facts.json"),
  runsDir: path.resolve(AGENT_ROOT, "runs"),
  skillsDir: path.resolve(AGENT_ROOT, ".claude", "skills"),

  /** Mastra model-router ids ("provider/model"). Needs ANTHROPIC_API_KEY. */
  writerModel: env.EMAIL_WRITER_MODEL ?? env.EMAIL_MODEL ?? "anthropic/claude-opus-5-5",
  graderModel: env.EMAIL_GRADER_MODEL ?? env.EMAIL_MODEL ?? "anthropic/claude-opus-5-5",
  writerEffort: (env.EMAIL_WRITER_EFFORT ?? "high") as Effort,
  graderEffort: (env.EMAIL_GRADER_EFFORT ?? "high") as Effort,
  maxOutputTokens: Number(env.EMAIL_MAX_OUTPUT_TOKENS ?? 64000),
  /** Product photos attached to the writer's first draft (one hero per featured collection). */
  maxImages: Number(env.EMAIL_MAX_IMAGES ?? 6),

  maxRounds: Number(env.EMAIL_MAX_ROUNDS ?? 3),
  bar: { overallPct: 80, minDimension: 3, minorGateCapPct: 60 },
};

export const WRITER_SKILLS = ["ecommerce-holiday-email", "copywriting", "copy-editing", "offers"];
export const GRADER_SKILLS = ["email-campaign-review"];
export const skillPath = (name: string) => path.join(config.skillsDir, name);
