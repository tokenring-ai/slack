import {TokenRingPlugin} from "@tokenring-ai/app";
import {EscalationService} from "@tokenring-ai/escalation";
import {EscalationServiceConfigSchema} from "@tokenring-ai/escalation/schema";
import {z} from "zod";
import {SlackEscalationProvider} from "./index.ts";
import packageJSON from './package.json' with {type: 'json'};
import {SlackEscalationProviderConfigSchema, SlackServiceConfigSchema} from "./schema.ts";
import SlackService from "./SlackService.ts";

const packageConfigSchema = z.object({
  slack: SlackServiceConfigSchema.optional(),
  escalation: EscalationServiceConfigSchema.optional()
});

export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(app, config) {
    if (config.slack) {
      app.addServices(new SlackService(app, config.slack));
      if (config.escalation) {
        app.waitForService(EscalationService, escalationService => {
          for (const [providerName, provider] of Object.entries(config.escalation!.providers)) {
            if (provider.type === 'slack') {
              escalationService.registerProvider(providerName, new SlackEscalationProvider(SlackEscalationProviderConfigSchema.parse(provider)));
            }
          }
        })
      }
    }
  },
  config: packageConfigSchema
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
