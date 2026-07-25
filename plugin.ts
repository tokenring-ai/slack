import type { TokenRingPlugin } from "@tokenring-ai/app";
import { EscalationService } from "@tokenring-ai/escalation";
import { requireSecret, resolveSecret } from "@tokenring-ai/secrets/SecretService";
import { z } from "zod";
import { SlackEscalationProvider } from "./index.ts";
import packageJSON from "./package.json" with { type: "json" };
import SlackService from "./SlackService.ts";
import { type ResolvedSlackBotConfig, SlackServiceConfigSchema } from "./schema.ts";

const packageConfigSchema = z.object({
  slack: SlackServiceConfigSchema.prefault({ bots: {} }),
});

export default {
  name: packageJSON.name,
  displayName: "Slack Integration",
  version: packageJSON.version,
  description: packageJSON.description,
  install(app, config) {
    const bots = Object.entries(config.slack.bots);
    if (bots.length === 0) return;

    // Resolve up front so a misconfigured token fails at boot, not on first message.
    const resolvedBots: Record<string, ResolvedSlackBotConfig> = {};
    for (const [botName, bot] of bots) {
      const { botToken, signingSecret, appToken: appTokenRef, ...rest } = bot;
      const appToken = resolveSecret(app, appTokenRef);
      resolvedBots[botName] = {
        ...rest,
        botToken: requireSecret(app, botToken, `Slack bot "${botName}" bot token`),
        signingSecret: requireSecret(app, signingSecret, `Slack bot "${botName}" signing secret`),
        ...(appToken !== undefined && { appToken }),
      };
    }

    app.addServices(new SlackService(app, { bots: resolvedBots }));

    app.waitForService(EscalationService, escalationService => {
      for (const [botName, bot] of Object.entries(config.slack.bots)) {
        if (bot.escalation) {
          escalationService.registerProvider(
            botName,
            new SlackEscalationProvider({
              type: "slack",
              bot: botName,
              channel: bot.escalation.channel,
            }),
          );
        }
      }
    });
  },
  configSchema: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
