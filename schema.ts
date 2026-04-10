import z from "zod";

export const SlackEscalationBotConfigSchema = z.object({
  channel: z.string(),
});

export const SlackBotConfigSchema = z.object({
  name: z.string(),
  botToken: z.string().min(1, "Bot token is required"),
  appToken: z.string().optional(),
  signingSecret: z.string().min(1, "Signing secret is required"),
  joinMessage: z.string().optional(),
  maxFileSize: z.number().default(20_971_520), // 20MB default
  channels: z.record(
    z.string(),
    z.object({
      channelId: z.string(),
      allowedUsers: z.array(z.string()).default([]),
      agentType: z.string(),
    }),
  ),
  dmAgentType: z.string().optional(),
  dmAllowedUsers: z.array(z.string()).default([]),
  escalation: SlackEscalationBotConfigSchema.optional(),
});

export type ParsedSlackBotConfig = z.output<typeof SlackBotConfigSchema>;

export const SlackServiceConfigSchema = z.object({
  bots: z.record(z.string(), SlackBotConfigSchema).default({}),
});
export type ParsedSlackServiceConfig = z.output<
  typeof SlackServiceConfigSchema
>;

export const SlackEscalationProviderConfigSchema = z.object({
  type: z.literal("slack"),
  bot: z.string(),
  channel: z.string(),
});

export type ParsedSlackEscalationProviderConfig = z.output<
  typeof SlackEscalationProviderConfigSchema
>;
export type ParsedSlackEscalationBotConfig = z.output<
  typeof SlackEscalationBotConfigSchema
>;
