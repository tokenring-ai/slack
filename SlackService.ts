import type TokenRingApp from "@tokenring-ai/app";
import type {TokenRingService} from "@tokenring-ai/app/types";
import waitForAbort from "@tokenring-ai/utility/promise/waitForAbort";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import type {ParsedSlackServiceConfig} from "./schema.ts";
import SlackBot from "./SlackBot.ts";

export default class SlackService implements TokenRingService {
  readonly name = "SlackService";
  description =
    "Manages multiple Slack bots for interacting with TokenRing agents.";

  private bots = new KeyedRegistry<SlackBot>();

  getAvailableBots = this.bots.keysArray;
  getBot = this.bots.get;

  constructor(
    private app: TokenRingApp,
    private options: ParsedSlackServiceConfig,
  ) {
  }

  async run(signal: AbortSignal): Promise<void> {
    this.app.serviceOutput(this, "Starting Slack bots...");

    for (const [botName, botConfig] of Object.entries(this.options.bots)) {
      const bot = new SlackBot(this.app, this, botName, botConfig);
      await bot.start();

      this.bots.set(botName, bot);
    }

    return waitForAbort(signal, async () => {
      for (const [botName, bot] of this.bots.entriesArray()) {
        await bot.stop();
        this.bots.unregister(botName);
      }
    });
  }
}
