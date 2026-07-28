import type TokenRingApp from "@tokenring-ai/app";
import type { TokenRingService } from "@tokenring-ai/app/types";
import { BotService } from "@tokenring-ai/bot";
import { deepEqual } from "@tokenring-ai/one-frontend/src/lib/utils";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
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
    const botService = this.app.requireService(BotService);

    this.app.serviceOutput(this, "Connecting Slack accounts...");

    await this.providers.reconcileAgainstAsync(this.options.accounts, {
      creating: async (accountName, accountConfig) => {
        const provider = new SlackMessagingProvider(this.app, this, accountName, accountConfig);
        await provider.start();
        botService.registerProvider(accountName, provider);
        return provider;
      },
      deleting: async (accountName, provider) => {
        botService.unregisterProvider(accountName);
        await provider.stop();
      },
      updating: async (accountName, provider, accountConfig) => {
        if (deepEqual(this.options.accounts[accountName], accountConfig)) return provider;
        botService.unregisterProvider(accountName);
        await provider.stop();

        const next = new SlackMessagingProvider(this.app, this, accountName, accountConfig);
        await next.start();
        botService.registerProvider(accountName, next);
        this.providers.set(accountName, next);

        return next;
      },
    });
    this.options = options;
  }

  async stop(): Promise<void> {
    const botService = this.app.requireService(BotService);
    for (const [accountName, provider] of this.providers.entriesArray()) {
      botService.unregisterProvider(accountName);
      await provider.stop();
      this.providers.unregister(accountName);
    }
  }
}
