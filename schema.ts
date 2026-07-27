import type { ConfigFieldMeta } from "@tokenring-ai/app/config/metadata";
import { secret, type WithResolvedSecrets } from "@tokenring-ai/secrets/secret";
import z from "zod";

/**
 * A Slack app installation. What the app *does* — who may talk to it, which
 * channels it sits in, which agent answers — is configured on the bot that uses
 * it, in the `bot` plugin.
 */
export const SlackAccountConfigSchema = z.object({
  botToken: secret({ description: "Slack bot OAuth token (xoxb-...)" }),
  appToken: secret({ description: "Slack app-level token for Socket Mode (xapp-...)" }).exactOptional(),
  signingSecret: secret({ description: "Slack request signing secret" }),
  maxFileSize: z
    .number()
    .default(20_971_520)
    .meta({ advanced: true, description: "Largest file, in bytes, fetched from Slack" } satisfies ConfigFieldMeta),
});

export type ParsedSlackAccountConfig = z.output<typeof SlackAccountConfigSchema>;

/** An account as handed to the service, with its token secrets already resolved. */
export type ResolvedSlackAccountConfig = WithResolvedSecrets<ParsedSlackAccountConfig, "botToken" | "appToken" | "signingSecret">;

export const SlackServiceConfigSchema = z
  .object({
    accounts: z
      .record(z.string(), SlackAccountConfigSchema)
      .default({})
      .meta({ label: "Accounts", description: "Slack app installations, keyed by the service name bots address them by" } satisfies ConfigFieldMeta),
  })
  .meta({ label: "Slack", description: "Slack app installations" } satisfies ConfigFieldMeta);

export type ParsedSlackServiceConfig = z.output<typeof SlackServiceConfigSchema>;

/** Service config with every account's secrets resolved. */
export type ResolvedSlackServiceConfig = { accounts: Record<string, ResolvedSlackAccountConfig> };
