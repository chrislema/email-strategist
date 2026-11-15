import { Mastra } from "@mastra/core/mastra";
import { campaignWriter } from "./agents/writer";
import { campaignGrader } from "./agents/grader";
import { campaignWorkflow } from "./workflows/campaign";

export const mastra = new Mastra({
  agents: { campaignWriter, campaignGrader },
  workflows: { campaignWorkflow },
});
