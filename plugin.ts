import {TokenRingPlugin} from "@tokenring-ai/app";
import {z} from "zod";
import packageJSON from './package.json' with {type: 'json'};
import SlackBotService, {SlackServiceConfigSchema} from "./SlackService.ts";

const packageConfigSchema = z.object({
  slack: SlackServiceConfigSchema.optional()
});

export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(app, config) {
    if (config.slack) {
      app.addServices(new SlackBotService(app, config.slack));
    }
  },
  config: packageConfigSchema
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
