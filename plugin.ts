import type {TokenRingPlugin} from "@tokenring-ai/app";
import {EscalationService} from "@tokenring-ai/escalation";
import {z} from "zod";
import {SlackEscalationProvider} from "./index.ts";
import packageJSON from "./package.json" with {type: "json"};
import {type ParsedSlackBotConfig, SlackServiceConfigSchema,} from "./schema.ts";
import SlackService from "./SlackService.ts";

const packageConfigSchema = z.object({
  slack: SlackServiceConfigSchema.prefault({bots: {}}),
});

function addBotsFromEnv(bots: Record<string, Partial<ParsedSlackBotConfig>>) {
  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^SLACK_BOT_TOKEN(\d*)$/);
    if (!match || !value) continue;
    const n = match[1];
    const signingSecret = process.env[`SLACK_SIGNING_SECRET${n}`];
    if (!signingSecret) continue;
    const name =
      process.env[`SLACK_BOT_NAME${n}`] ?? `Slack Bot${n ? ` ${n}` : ""}`;
    const escalationChannel = process.env[`SLACK_ESCALATION_CHANNEL${n}`];

    bots[name] = {
      name,
      botToken: value,
      signingSecret,
      appToken: process.env[`SLACK_APP_TOKEN${n}`],
      escalation: escalationChannel
        ? {channel: escalationChannel}
        : undefined,
      channels: {},
    };
  }
}

export default {
  name: packageJSON.name,
  displayName: "Slack Integration",
  version: packageJSON.version,
  description: packageJSON.description,
  install(app, config) {
    addBotsFromEnv(config.slack.bots);
    if (Object.keys(config.slack.bots).length === 0) return;

    app.addServices(
      new SlackService(app, SlackServiceConfigSchema.parse(config.slack)),
    );

    app.waitForService(EscalationService, (escalationService) => {
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
  config: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
