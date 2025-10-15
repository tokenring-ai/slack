import {AgentTeam, TokenRingPackage} from "@tokenring-ai/agent";
import packageJSON from './package.json' with {type: 'json'};
import SlackBotService, {SlackServiceConfigSchema} from "./SlackService.ts";

export const packageInfo: TokenRingPackage = {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(agentTeam: AgentTeam) {
    const slackConfig = agentTeam.getConfigSlice("slack", SlackServiceConfigSchema.optional());

    if (slackConfig) {
      agentTeam.services.register(new SlackBotService(slackConfig));
    }
  },
};

export {default as SlackService} from "./SlackService.ts";