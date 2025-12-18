import TokenRingApp from "@tokenring-ai/app";
import {TokenRingPlugin} from "@tokenring-ai/app";
import packageJSON from './package.json' with {type: 'json'};
import SlackBotService, {SlackServiceConfigSchema} from "./SlackService.ts";


export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(app: TokenRingApp) {
    const slackConfig = app.getConfigSlice("slack", SlackServiceConfigSchema.optional());

    if (slackConfig) {
      app.addServices(new SlackBotService(app, slackConfig));
    }
  },
} satisfies TokenRingPlugin;
