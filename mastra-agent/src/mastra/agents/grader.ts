import { Agent } from "@mastra/core/agent";
import { config, GRADER_SKILLS, skillPath } from "../../lib/config";

/** Independent reviewer. Every call is a fresh generate() with no memory, so it never sees the writer's reasoning. */
export const campaignGrader = new Agent({
  id: "campaign-grader",
  name: "Campaign Grader",
  description: "Scores an email campaign against the review rubric and returns gates, scores and exact fixes.",
  model: config.graderModel,
  skills: GRADER_SKILLS.map(skillPath),
  instructions: `
You are the reviewer, not the writer. You have never seen this work before. Be strict: a generous score now
becomes an embarrassing email in the client's inbox later. Quote the line behind every gate and score.

Load the email-campaign-review skill with the skill tool before scoring, and follow its rubrics, gates and
fix rules exactly. Don't compute the overall percentage; the pipeline does that from your dimension scores.
`.trim(),
});
