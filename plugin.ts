import type { TokenRingPlugin } from "@tokenring-ai/app";
import { requireSecret, resolveSecret } from "@tokenring-ai/secrets/SecretService";
import { z } from "zod";
import packageJSON from "./package.json" with { type: "json" };
import SlackService from "./SlackService.ts";
import { type ResolvedSlackAccountConfig, SlackServiceConfigSchema } from "./schema.ts";

const packageConfigSchema = z.object({
  slack: SlackServiceConfigSchema.prefault({ accounts: {} }),
});

export default {
  name: packageJSON.name,
  displayName: "Slack Integration",
  version: packageJSON.version,
  description: packageJSON.description,
  install(app, config) {
    const accounts = Object.entries(config.slack.accounts);
    if (accounts.length === 0) return;

    // Resolve up front so a misconfigured token fails at boot, not on first message.
    const resolvedAccounts: Record<string, ResolvedSlackAccountConfig> = {};
    for (const [accountName, account] of accounts) {
      const { botToken, signingSecret, appToken: appTokenRef, ...rest } = account;
      const appToken = resolveSecret(app, appTokenRef);
      resolvedAccounts[accountName] = {
        ...rest,
        botToken: requireSecret(app, botToken, `Slack account "${accountName}" bot token`),
        signingSecret: requireSecret(app, signingSecret, `Slack account "${accountName}" signing secret`),
        ...(appToken !== undefined && { appToken }),
      };
    }

    app.addServices(new SlackService(app, { accounts: resolvedAccounts }));
  },
  configSchema: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
