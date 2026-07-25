import { secret, type WithResolvedSecrets } from "@tokenring-ai/secrets/secret";
import z from "zod";

export const SlackEscalationBotConfigSchema = z.object({
  channel: z.string(),
});

export const SlackBotConfigSchema = z.object({
  name: z.string(),
  botToken: secret({ description: "Slack bot OAuth token (xoxb-...)" }),
  appToken: secret({ description: "Slack app-level token for Socket Mode (xapp-...)" }).exactOptional(),
  signingSecret: secret({ description: "Slack request signing secret" }),
  joinMessage: z.string().exactOptional(),
  maxFileSize: z.number().default(20_971_520), // 20MB default
  channels: z.record(
    z.string(),
    z.object({
      channelId: z.string(),
      allowedUsers: z.array(z.string()).default([]),
      agentType: z.string(),
    }),
  ),
  dmAgentType: z.string().exactOptional(),
  dmAllowedUsers: z.array(z.string()).default([]),
  escalation: SlackEscalationBotConfigSchema.exactOptional(),
});

export type ParsedSlackBotConfig = z.output<typeof SlackBotConfigSchema>;

/** A bot as handed to the service, with its token secrets already resolved. */
export type ResolvedSlackBotConfig = WithResolvedSecrets<ParsedSlackBotConfig, "botToken" | "appToken" | "signingSecret">;

export const SlackServiceConfigSchema = z.object({
  bots: z.record(z.string(), SlackBotConfigSchema).default({}),
});
export type ParsedSlackServiceConfig = z.output<typeof SlackServiceConfigSchema>;

/** Service config with every bot's secrets resolved. */
export type ResolvedSlackServiceConfig = { bots: Record<string, ResolvedSlackBotConfig> };

export const SlackEscalationProviderConfigSchema = z.object({
  type: z.literal("slack"),
  bot: z.string(),
  channel: z.string(),
});

export type ParsedSlackEscalationProviderConfig = z.output<typeof SlackEscalationProviderConfigSchema>;
export type ParsedSlackEscalationBotConfig = z.output<typeof SlackEscalationBotConfigSchema>;
