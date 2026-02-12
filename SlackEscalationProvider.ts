import {Agent} from "@tokenring-ai/agent";
import type {CommunicationChannel, EscalationProvider} from "@tokenring-ai/escalation/EscalationProvider";
import type {ParsedSlackEscalationProviderConfig} from "./schema.ts";
import SlackService from "./SlackService.ts";

export default class SlackEscalationProvider implements EscalationProvider {
  constructor(readonly config: ParsedSlackEscalationProviderConfig) {}
  async createCommunicationChannelWithUser(channelName: string, agent: Agent): Promise<CommunicationChannel> {
    const slackService = agent.requireServiceByType(SlackService);

    const bot = slackService.getBot(this.config.bot);
    if (!bot) throw new Error(`Bot ${this.config.bot} not found`);

    return bot.createCommunicationChannelWithChannel(channelName);
  }
}
