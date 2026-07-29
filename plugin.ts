import { AgentCommandService } from "@tokenring-ai/agent";
import type { TokenRingPlugin } from "@tokenring-ai/app";
import { requireSecret, resolveSecret } from "@tokenring-ai/secrets/SecretService";
import { z } from "zod";
import agentCommands from "./commands.ts";
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
  install(app) {
    app.addServices(new SlackService(app));
    app.waitForService(AgentCommandService, commandService => {
      commandService.addAgentCommands(agentCommands);
    });
  },
  async reconfigure(app, config) {
    // Resolve up front so a misconfigured token fails at configure, not on first message.
    const resolvedAccounts: Record<string, ResolvedSlackAccountConfig> = {};
    for (const [accountName, account] of Object.entries(config.slack.accounts)) {
      const { botToken, signingSecret, appToken: appTokenRef, ...rest } = account;
      const appToken = resolveSecret(app, appTokenRef);
      resolvedAccounts[accountName] = {
        ...rest,
        botToken: requireSecret(app, botToken, `Slack account "${accountName}" bot token`),
        signingSecret: requireSecret(app, signingSecret, `Slack account "${accountName}" signing secret`),
        ...(appToken !== undefined && { appToken }),
      };
    }

    await app.requireService(SlackService).reconfigure({ accounts: resolvedAccounts });
  },
  configSchema: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
