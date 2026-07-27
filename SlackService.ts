import type TokenRingApp from "@tokenring-ai/app";
import type { TokenRingService } from "@tokenring-ai/app/types";
import { BotService } from "@tokenring-ai/bot";
import waitForAbort from "@tokenring-ai/utility/promise/waitForAbort";
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

  getAvailableAccounts = this.providers.keysArray;
  getProvider = this.providers.get;

  constructor(
    private app: TokenRingApp,
    private options: ResolvedSlackServiceConfig,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    const botService = this.app.requireService(BotService);

    this.app.serviceOutput(this, "Connecting Slack accounts...");

    for (const [accountName, accountConfig] of Object.entries(this.options.accounts)) {
      const provider = new SlackMessagingProvider(this.app, this, accountName, accountConfig);
      await provider.start();

      this.providers.set(accountName, provider);
      botService.registerProvider(accountName, provider);
    }

    return waitForAbort(signal, async () => {
      for (const [accountName, provider] of this.providers.entriesArray()) {
        botService.unregisterProvider(accountName);
        await provider.stop();
        this.providers.unregister(accountName);
      }
    });
  }
}
