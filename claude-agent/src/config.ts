import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";

/** claude-agent/ */
export const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The repo root, which is also where the client's (git-ignored) materials live by default. */
export const REPO_ROOT = path.resolve(AGENT_ROOT, "..");

const env = process.env;

export const config = {
  /** Folder holding the client's resources and asset folders. Never committed. */
  clientDir: path.resolve(env.EMAIL_CLIENT_DIR ?? REPO_ROOT),
  /** Subfolders of clientDir that hold brand files (brand guide PDF, logos). */
  resourcesDir: env.EMAIL_RESOURCES_DIR ?? "resources",
  /** Subfolder of clientDir that holds one folder per collection, plus lifestyle-photo folders. */
  assetsDir: env.EMAIL_ASSETS_DIR ?? "Client Shared Assets",
  /** Default facts file (git-ignored). */
  factsPath: path.resolve(AGENT_ROOT, env.EMAIL_FACTS ?? "client/facts.json"),
  runsDir: path.resolve(AGENT_ROOT, "runs"),

  writerModel: env.EMAIL_WRITER_MODEL ?? env.EMAIL_MODEL ?? "claude-opus-5-5",
  graderModel: env.EMAIL_GRADER_MODEL ?? env.EMAIL_MODEL ?? "claude-opus-5-5",
  writerEffort: (env.EMAIL_WRITER_EFFORT ?? "high") as EffortLevel,
  graderEffort: (env.EMAIL_GRADER_EFFORT ?? "high") as EffortLevel,

  /** Grade → fix rounds. The review skill says stop at 3: past that you polish the score, not the emails. */
  maxRounds: Number(env.EMAIL_MAX_ROUNDS ?? 3),
  /** Hard stop per agent call (USD, SDK estimate). */
  budgetPerCallUsd: Number(env.EMAIL_BUDGET_PER_CALL_USD ?? 10),
  maxTurnsPerCall: Number(env.EMAIL_MAX_TURNS ?? 60),

  /** The client-ready bar, from the review skill. */
  bar: { overallPct: 80, minDimension: 3, minorGateCapPct: 60 },
};

/** Skills each agent may use. The writer never gets the grader's rubric. */
export const WRITER_SKILLS = ["ecommerce-holiday-email", "copywriting", "copy-editing", "offers"];
export const GRADER_SKILLS = ["email-campaign-review"];
export const REVIEW_SKILL_DIR = "email-campaign-review";
