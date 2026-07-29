import type TokenRingApp from "@tokenring-ai/app";
import { ConfigurationError, type TokenRingService } from "@tokenring-ai/app/types";
import { BotService } from "@tokenring-ai/bot";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import { deepEquals } from "bun";
import SlackMessagingProvider from "./SlackMessagingProvider.ts";
import type { ResolvedSlackServiceConfig } from "./schema.ts";

/**
 * Connects the configured Slack apps and registers each one with the bot
 * service, where it becomes the `slack`-style prefix of a `service:userId`
 * target.
 */
export default class SlackService implements TokenRingService {
  readonly name = "SlackService";
  description = "Connects Slack app installations to the bot service.";

  private providers = new KeyedRegistry<SlackMessagingProvider>();
  private options: ResolvedSlackServiceConfig = { accounts: {} };

  getAvailableAccounts = this.providers.keysArray;
  getProvider = this.providers.get;

  constructor(private app: TokenRingApp) {}

  async reconfigure(options: ResolvedSlackServiceConfig): Promise<void> {
    const botService = this.requireBotService();

    // Reconcile the live providers against the *incoming* accounts; `this.options`
    // is the previous snapshot, used below only to spot which ones actually changed.
    await this.providers.reconcileAgainstAsync(options.accounts, {
      creating: async (accountName, accountConfig) => {
        this.app.serviceOutput(this, `Connecting Slack account ${accountName}`);
        const provider = new SlackMessagingProvider(this.app, this, accountName, accountConfig);
        await provider.start();
        botService.registerProvider(accountName, provider);
        return provider;
      },
      deleting: async (accountName, provider) => {
        this.app.serviceOutput(this, `Stopping Slack account ${accountName}`);
        botService.unregisterProvider(accountName);
        await provider.stop();
      },
      updating: async (accountName, provider, accountConfig) => {
        if (deepEquals(this.options.accounts[accountName], accountConfig, true)) return provider;

        this.app.serviceOutput(this, `Reconnecting Slack account ${accountName}`);
        botService.unregisterProvider(accountName);
        await provider.stop();

        const next = new SlackMessagingProvider(this.app, this, accountName, accountConfig);
        await next.start();
        botService.registerProvider(accountName, next);

        return next;
      },
    });
    this.options = options;
  }

  async stop(): Promise<void> {
    const botService = this.app.getService(BotService);
    for (const [accountName, provider] of this.providers.entriesArray()) {
      botService?.unregisterProvider(accountName);
      await provider.stop();
      this.providers.unregister(accountName);
    }
  }

  private requireBotService(): BotService {
    const botService = this.app.getService(BotService);
    if (!botService) {
      throw new ConfigurationError(
        this.name,
        "Slack accounts are configured but the @tokenring-ai/bot plugin is not installed, so there is nothing to connect them to",
      );
    }
    return botService;
  }
}
