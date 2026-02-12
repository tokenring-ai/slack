import {App} from '@slack/bolt';
import {Agent, AgentManager} from "@tokenring-ai/agent";
import {AgentEventState} from "@tokenring-ai/agent/state/agentEventState";
import {AgentExecutionState} from "@tokenring-ai/agent/state/agentExecutionState";
import TokenRingApp from "@tokenring-ai/app";
import type {CommunicationChannel} from "@tokenring-ai/escalation/EscalationProvider";
import type {ParsedSlackBotConfig} from "./schema.ts";

type UserChannel = {
  channelId: string;
  trackedMessageIds: Set<string>;
  queue: string[];
  resolve?: (value: IteratorResult<string>) => void;
  closed: boolean;
};

type ChatBuffer = {
  text: string;
  lastSentText?: string;
  messageTs?: string;
};

export default class SlackBot {
  private app!: App;
  private botUserId?: string;
  private channelAgents = new Map<string, Agent>();
  private userChannels = new Map<string, UserChannel>();
  private chatBuffers = new Map<string, ChatBuffer>();
  private lastSendTime = 0;
  private sendTimer: NodeJS.Timeout | null = null;
  private pendingChannelIds = new Set<string>();
  private isProcessing = false;
  private messageIdToBotUserId = new Map<string, string>();

  constructor(
    private tokenRingApp: TokenRingApp,
    private botName: string,
    private config: ParsedSlackBotConfig
  ) {}

  async start(): Promise<void> {
    this.app = new App({
      token: this.config.botToken,
      signingSecret: this.config.signingSecret,
      socketMode: !!this.config.appToken,
      appToken: this.config.appToken,
    });

    const authResult = await this.app.client.auth.test();
    this.botUserId = authResult.user_id;
    this.tokenRingApp.serviceOutput(`Bot ${this.botName} (@${authResult.user}) started`);

    this.app.message(async ({message, say}) => {
      try {
        await this.handleMessage(message as any, say);
      } catch (error) {
        this.tokenRingApp.serviceError('Error processing message:', error);
      }
    });

    this.app.event('app_mention', async ({event, say}) => {
      try {
        await this.handleMessage(event as any, say);
      } catch (error) {
        this.tokenRingApp.serviceError('Error processing mention:', error);
      }
    });

    await this.app.start();

    for (const channelConfig of Object.values(this.config.channels)) {
      try {
        await this.app.client.chat.postMessage({
          channel: channelConfig.channelId,
          text: `🤖 Bot ${this.botName} is now online and ready!`
        });
      } catch (error) {
        this.tokenRingApp.serviceError(`Failed to announce to channel ${channelConfig.channelId}:`, error);
      }
    }
  }

  async stop(): Promise<void> {
    if (this.sendTimer) {
      clearTimeout(this.sendTimer);
      this.sendTimer = null;
    }

    const channelIds = [...this.pendingChannelIds];
    for (const channelId of channelIds) {
      await this.flushBuffer(channelId);
    }
    this.pendingChannelIds.clear();
    this.chatBuffers.clear();

    const agentManager = this.tokenRingApp.requireService(AgentManager);
    for (const agent of this.channelAgents.values()) {
      await agentManager.deleteAgent(agent);
    }
    this.channelAgents.clear();

    try {
      await this.app.stop();
    } catch (error) {
      this.tokenRingApp.serviceError('Error stopping app:', error);
    }
  }

  createCommunicationChannelWithChannel(channelName: string): CommunicationChannel {
    const channelConfig = this.config.channels[channelName];
    if (!channelConfig) {
      throw new Error(`Channel "${channelName}" not found in configuration.`);
    }
    return this.createCommunicationChannelWithUser(channelConfig.channelId);
  }

  createCommunicationChannelWithUser(userId: string): CommunicationChannel {
    const channelId = userId;
    const trackedMessageIds = new Set<string>();

    const channel: UserChannel = {
      channelId,
      trackedMessageIds,
      queue: [],
      closed: false
    };

    return {
      send: async (message: string) => {
        const result = await this.app.client.chat.postMessage({
          channel: channelId,
          text: message
        });
        const messageId = `${result.channel}-${result.ts}`;
        trackedMessageIds.add(messageId);
        this.userChannels.set(messageId, channel);
        this.messageIdToBotUserId.set(messageId, this.botUserId!);
      },
      receive: async function*(): AsyncGenerator<string> {
        while (!channel.closed) {
          if (channel.queue.length > 0) {
            yield channel.queue.shift()!;
          } else {
            await new Promise<IteratorResult<string>>((resolve) => {
              channel.resolve = resolve;
            });
          }
        }
      },
      close: async () => {
        channel.closed = true;
        if (channel.resolve) {
          channel.resolve({ value: undefined, done: true });
          channel.resolve = undefined;
        }
        for (const msgId of trackedMessageIds) {
          this.userChannels.delete(msgId);
          this.messageIdToBotUserId.delete(msgId);
        }
        trackedMessageIds.clear();
      }
    };
  }

  private async handleMessage(msg: any, say: any): Promise<void> {
    const userId = msg.user;
    const channelId = msg.channel;
    const text = msg.text || '';
    const messageId = `${channelId}-${msg.ts}`;

    if (!userId || !text.trim() || msg.bot_id) return;

    // Check if reply to tracked message
    if (msg.thread_ts) {
      const threadMessageId = `${channelId}-${msg.thread_ts}`;
      const replyToBotUserId = this.messageIdToBotUserId.get(threadMessageId);
      if (replyToBotUserId !== this.botUserId) return;

      const channel = this.userChannels.get(threadMessageId);
      if (channel) {
        channel.trackedMessageIds.add(messageId);
        this.userChannels.set(messageId, channel);
        this.messageIdToBotUserId.set(messageId, this.botUserId!);

        if (channel.resolve) {
          channel.resolve({ value: text, done: false });
          channel.resolve = undefined;
        } else {
          channel.queue.push(text);
        }
        return;
      }
    }

    // Check if channel message with bot mention
    const channelConfig = Object.values(this.config.channels).find(c => c.channelId === channelId);
    if (!channelConfig) return;

    if (channelConfig.allowedUsers.length > 0 && !channelConfig.allowedUsers.includes(userId)) {
      await say("Sorry, you are not authorized.");
      return;
    }

    // Remove bot mention from text
    const cleanText = text.replace(/<@[^>]+>/g, '').trim();
    if (!cleanText) return;

    await this.handleAgentMessage(channelId, cleanText, channelConfig.agentType, say);
  }

  private async handleAgentMessage(channelId: string, text: string, agentType: string, say: any): Promise<void> {
    const agent = await this.getOrCreateAgentForChannel(channelId, agentType);
    await agent.waitForState(AgentExecutionState, (state) => state.idle);

    let responseSent = false;
    const requestId = agent.handleInput({message: `/chat send ${text}`});
    const abortController = new AbortController();
    const eventCursor = agent.getState(AgentEventState).getEventCursorFromCurrentPosition();

    let timeoutHandle: NodeJS.Timeout | null = null;
    if (agent.config.maxRunTime > 0) {
      timeoutHandle = setTimeout(() => abortController.abort(), agent.config.maxRunTime * 1000);
    }

    try {
      for await (const state of agent.subscribeStateAsync(AgentEventState, abortController.signal)) {
        for (const event of state.yieldEventsByCursor(eventCursor)) {
          switch (event.type) {
            case 'output.chat':
              responseSent = true;
              this.handleChatOutput(channelId, event.message);
              break;
            case 'output.info':
            case 'output.warning':
            case 'output.error':
              await say(`[${event.type.split('.')[1].toUpperCase()}]: ${event.message}`);
              break;
            case 'input.handled':
              if (event.requestId === requestId) {
                this.pendingChannelIds.add(channelId);
                this.scheduleSend();
                if (!responseSent) {
                  await say("No response received from agent.");
                }
                abortController.abort();
              }
              break;
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        this.tokenRingApp.serviceError('Error processing message:', error);
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      this.pendingChannelIds.add(channelId);
      this.scheduleSend();
    }
  }

  private handleChatOutput(channelId: string, content: string): void {
    let buffer = this.chatBuffers.get(channelId);
    if (!buffer) {
      buffer = { text: '' };
      this.chatBuffers.set(channelId, buffer);
    }
    buffer.text += content;
    this.pendingChannelIds.add(channelId);
    this.scheduleSend();
  }

  private readonly MAX_MESSAGE_LENGTH = 3900;

  private scheduleSend(): void {
    if (this.sendTimer !== null || this.isProcessing) return;
    const now = Date.now();
    const delay = Math.max(0, (this.lastSendTime + 250) - now);
    this.sendTimer = setTimeout(() => this.processPending(), delay);
  }

  private async processPending(): Promise<void> {
    if (this.isProcessing) return;
    this.sendTimer = null;
    this.isProcessing = true;

    try {
      const channelIds = [...this.pendingChannelIds];
      this.pendingChannelIds.clear();
      for (const channelId of channelIds) {
        await this.flushBuffer(channelId);
      }
      this.lastSendTime = Date.now();
    } finally {
      this.isProcessing = false;
      if (this.pendingChannelIds.size > 0) {
        this.scheduleSend();
      }
    }
  }

  private async flushBuffer(channelId: string): Promise<void> {
    const buffer = this.chatBuffers.get(channelId);
    if (!buffer || !buffer.text || buffer.text === buffer.lastSentText) return;

    let textToSend = buffer.text;

    if (textToSend.length > this.MAX_MESSAGE_LENGTH) {
      const currentChunk = textToSend.substring(0, this.MAX_MESSAGE_LENGTH);
      const remaining = textToSend.substring(this.MAX_MESSAGE_LENGTH);

      try {
        if (buffer.messageTs) {
          await this.app.client.chat.update({
            channel: channelId,
            ts: buffer.messageTs,
            text: currentChunk
          });
        } else {
          const result = await this.app.client.chat.postMessage({
            channel: channelId,
            text: currentChunk
          });
          buffer.messageTs = result.ts;
          this.messageIdToBotUserId.set(`${channelId}-${result.ts}`, this.botUserId!);
        }
      } catch (error) {
        this.tokenRingApp.serviceError('Error flushing partial buffer:', error);
      }

      buffer.text = remaining;
      buffer.messageTs = undefined;
      buffer.lastSentText = '';
      this.pendingChannelIds.add(channelId);
      return;
    }

    try {
      if (!buffer.messageTs) {
        const result = await this.app.client.chat.postMessage({
          channel: channelId,
          text: textToSend
        });
        buffer.messageTs = result.ts;
        buffer.lastSentText = textToSend;
        this.messageIdToBotUserId.set(`${channelId}-${result.ts}`, this.botUserId!);
      } else {
        try {
          await this.app.client.chat.update({
            channel: channelId,
            ts: buffer.messageTs,
            text: textToSend
          });
          buffer.lastSentText = textToSend;
        } catch (editError: any) {
          if (!editError.message?.includes("message_not_found")) {
            throw editError;
          }
        }
      }
    } catch (error) {
      this.tokenRingApp.serviceError('Error flushing buffer:', error);
    }
  }

  private async getOrCreateAgentForChannel(channelId: string, agentType: string): Promise<Agent> {
    if (!this.channelAgents.has(channelId)) {
      const agentManager = this.tokenRingApp.requireService(AgentManager);
      const agent = await agentManager.spawnAgent({agentType, headless: true});
      this.channelAgents.set(channelId, agent);
    }
    return this.channelAgents.get(channelId)!;
  }

  getBotUserId(): string | undefined {
    return this.botUserId;
  }
}
