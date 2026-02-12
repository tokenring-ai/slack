import TokenRingApp from "@tokenring-ai/app";
import {TokenRingService} from "@tokenring-ai/app/types";
import waitForAbort from "@tokenring-ai/utility/promise/waitForAbort";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import type {ParsedSlackServiceConfig} from "./schema.ts";
import SlackBot from './SlackBot.ts';

export default class SlackService implements TokenRingService {
  readonly name = "SlackService";
  description = "Manages multiple Slack bots for interacting with TokenRing agents.";

  private bots = new KeyedRegistry<SlackBot>();

  getAvailableBots = this.bots.getAllItemNames;
  getBot = this.bots.getItemByName;

  constructor(private app: TokenRingApp, private options: ParsedSlackServiceConfig) {}

  async run(signal: AbortSignal): Promise<void> {
    this.app.serviceOutput("Starting Slack bots...");

    for (const [botName, botConfig] of Object.entries(this.options.bots)) {
      const bot = new SlackBot(
        this.app,
        botName,
        botConfig
      );
      await bot.start();

      this.bots.register(botName, bot);
    }

    return waitForAbort(signal, async () => {
      for (const [botName, bot] of this.bots.entries()) {
        await bot.stop();
        this.bots.unregister(botName);
      }
    });
  }
}