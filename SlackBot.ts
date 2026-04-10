import {App} from "@slack/bolt";
import {type Agent, AgentManager} from "@tokenring-ai/agent";
import type {InputAttachment} from "@tokenring-ai/agent/AgentEvents";
import {AgentEventState} from "@tokenring-ai/agent/state/agentEventState";
import type TokenRingApp from "@tokenring-ai/app";
import type {CommunicationChannel} from "@tokenring-ai/escalation/EscalationProvider";
import axios from "axios";
import type {ParsedSlackBotConfig} from "./schema.ts";
import type SlackService from "./SlackService.ts";
import {splitIntoChunks} from "./splitIntoChunks.ts";

type UserChannel = {
  channelId: string;
  trackedMessageIds: Set<string>;
  queue: string[];
  resolve?: (value: IteratorResult<string>) => void;
  closed: boolean;
};

type ChatResponse = {
  text: string | null;
  messageTimestamps: (string | undefined)[];
  sentTexts: string[];
  isComplete?: boolean;
};

export default class SlackBot {
  private app!: App;
  private botUserId?: string;
  private channelAgents = new Map<string, Agent>();
  private userChannels = new Map<string, UserChannel>();
  private chatResponses = new Map<string, ChatResponse>();
  private lastSendTime = 0;
  private sendTimer: NodeJS.Timeout | null = null;
  private pendingChannelIds = new Set<string>();
  private isProcessing = false;
  private messageIdToBotUserId = new Map<string, string>();
  private activeRequests = new Map<
    string,
    { channelId: string; responseSent: boolean }
  >();
  private channelListeners = new Set<string>();

  constructor(
    private tokenRingApp: TokenRingApp,
    private slackService: SlackService,
    private botName: string,
    private config: ParsedSlackBotConfig,
  ) {
  }

  async start(): Promise<void> {
    this.app = new App({
      token: this.config.botToken,
      signingSecret: this.config.signingSecret,
      socketMode: !!this.config.appToken,
      appToken: this.config.appToken,
    });

    const authResult = await this.app.client.auth.test();
    this.botUserId = authResult.user_id;
    this.tokenRingApp.serviceOutput(
      this.slackService,
      `Bot ${this.botName} (@${authResult.user}) started`,
    );

    this.app.message(async ({message, say}) => {
      try {
        await this.handleMessage(message as any, say);
      } catch (error) {
        this.tokenRingApp.serviceError(
          this.slackService,
          "Error processing message:",
          error,
        );
      }
    });

    this.app.event("app_mention", async ({event, say}) => {
      try {
        await this.handleMessage(event as any, say);
      } catch (error) {
        this.tokenRingApp.serviceError(
          this.slackService,
          "Error processing mention:",
          error,
        );
      }
    });

    await this.app.start();

    if (this.config.joinMessage) {
      for (const channelConfig of Object.values(this.config.channels)) {
        try {
          await this.app.client.chat.postMessage({
            channel: channelConfig.channelId,
            text: this.config.joinMessage,
          });
        } catch (error) {
          this.tokenRingApp.serviceError(
            this.slackService,
            `Failed to announce to channel ${channelConfig.channelId}:`,
            error,
          );
        }
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
    this.chatResponses.clear();
    this.channelListeners.clear();
    this.activeRequests.clear();

    const agentManager = this.tokenRingApp.requireService(AgentManager);
    for (const agentPromise of this.channelAgents.values()) {
      const agent = await agentPromise;
      await agentManager.deleteAgent(agent.id, "Slack bot was shut down.");
    }
    this.channelAgents.clear();

    try {
      await this.app.stop();
    } catch (error) {
      this.tokenRingApp.serviceError(
        this.slackService,
        "Error stopping app:",
        error,
      );
    }
  }

  createCommunicationChannelWithChannel(
    channelName: string,
  ): CommunicationChannel {
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
      closed: false,
    };

    return {
      send: async (message: string) => {
        const result = await this.app.client.chat.postMessage({
          channel: channelId,
          text: message,
        });
        if (!result.channel || !result.ts) {
          throw new Error(
            `Slack did not return message id fields for outbound message in channel ${channelId}.`,
          );
        }
        const messageId = `${result.channel}-${result.ts}`;
        trackedMessageIds.add(messageId);
        this.userChannels.set(messageId, channel);
        this.messageIdToBotUserId.set(messageId, this.botUserId!);
      },
      receive: async function* (): AsyncGenerator<string> {
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
      [Symbol.dispose]: () => {
        channel.closed = true;
        if (channel.resolve) {
          channel.resolve({value: undefined, done: true});
          channel.resolve = undefined;
        }
        for (const msgId of trackedMessageIds) {
          this.userChannels.delete(msgId);
          this.messageIdToBotUserId.delete(msgId);
        }
        trackedMessageIds.clear();
      },
    };
  }

  private async handleMessage(msg: any, say: any): Promise<void> {
    const userId = msg.user;
    const channelId = msg.channel;
    const text = msg.text ?? "";

    if (!userId || !channelId || msg.bot_id || msg.subtype === "bot_message")
      return;

    const messageId = `${channelId}-${msg.ts}`;

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

        if (text && channel.resolve) {
          channel.resolve({value: text, done: false});
          channel.resolve = undefined;
        } else if (text) {
          channel.queue.push(text);
        }
        return;
      }
    }

    // Handle direct messages.
    if (channelId.startsWith("D")) {
      if (!this.config.dmAgentType) {
        if (text.trim().length > 0) {
          await say("DMs are not enabled for this bot.");
        }
        return;
      }

      if (
        this.config.dmAllowedUsers.length > 0 &&
        !this.config.dmAllowedUsers.includes(userId)
      ) {
        await say("Sorry, you are not authorized to DM this bot.");
        return;
      }

      const attachments = await this.extractAllAttachments(msg);
      if (!text.trim() && attachments.length === 0) return;

      const agent = await this.ensureAgentForChannel(
        userId,
        this.config.dmAgentType,
      );
      await agent.waitForState(AgentEventState, (state) => state.idle);

      this.chatResponses.set(channelId, {
        text: null,
        messageTimestamps: [],
        sentTexts: [],
      });
      const requestId = agent.handleInput({
        from: `Slack DM from ${userId}`,
        message: `/chat send From: <@${userId}> ${text || "No text sent"}`,
        attachments,
      });
      this.activeRequests.set(requestId, {channelId, responseSent: false});

      await this.flushBuffer(channelId);
      return;
    }

    // Check if configured channel message with bot mention.
    const channelConfig = Object.values(this.config.channels).find(
      (c) => c.channelId === channelId,
    );
    if (!channelConfig) return;
    if (!text.includes(`<@${this.botUserId}>`)) return;

    if (
      channelConfig.allowedUsers.length > 0 &&
      !channelConfig.allowedUsers.includes(userId)
    ) {
      await say("Sorry, you are not authorized.");
      return;
    }

    // Remove bot mention from text
    const cleanText = text.replace(/<@[^>]+>/g, "").trim();
    const attachments = await this.extractAllAttachments(msg);
    if (!cleanText && attachments.length === 0) return;

    const agent = await this.ensureAgentForChannel(
      channelId,
      channelConfig.agentType,
    );
    await agent.waitForState(AgentEventState, (state) => state.idle);

    this.chatResponses.set(channelId, {
      text: null,
      messageTimestamps: [],
      sentTexts: [],
    });

    const requestId = agent.handleInput({
      from: `Slack channel message from ${userId}`,
      message: `/chat send From: <@${userId}> ${cleanText || "No text sent"}`,
      attachments,
    });
    this.activeRequests.set(requestId, {channelId, responseSent: false});

    await this.flushBuffer(channelId);
  }

  private async extractAllAttachments(msg: any): Promise<InputAttachment[]> {
    const attachments: InputAttachment[] = [];
    const files: any[] = Array.isArray(msg.files) ? msg.files : [];

    for (const file of files) {
      const size = typeof file.size === "number" ? file.size : undefined;
      if (size && size > this.config.maxFileSize) {
        this.tokenRingApp.serviceOutput(
          this.slackService,
          `Slack file ${file.id ?? file.name ?? "unknown"} exceeded maxFileSize (${size} bytes), skipping.`,
        );
        continue;
      }

      const fileUrl = file.url_private_download ?? file.url_private;
      if (!fileUrl) continue;

      try {
        const {data} = await axios.get(fileUrl, {
          responseType: "arraybuffer",
          headers: {
            Authorization: `Bearer ${this.config.botToken}`,
          },
        });

        attachments.push({
          type: "attachment",
          name: file.name || `slack_file_${file.id ?? Date.now()}`,
          mimeType: file.mimetype || "application/octet-stream",
          body: Buffer.from(data as ArrayBuffer).toString("base64"),
          encoding: "base64",
          timestamp: Date.now(),
        });
      } catch (error) {
        this.tokenRingApp.serviceError(
          this.slackService,
          `Failed to fetch Slack file ${file.id ?? file.name ?? "unknown"}:`,
          error,
        );
      }
    }

    return attachments;
  }

  private async ensureAgentForChannel(
    channelId: string,
    agentType: string,
  ): Promise<Agent> {
    if (!this.channelAgents.has(channelId)) {
      const agentManager = this.tokenRingApp.requireService(AgentManager);
      const agent = agentManager.spawnAgent({agentType, headless: true});
      this.channelAgents.set(channelId, agent);
    }

    const agent = await this.channelAgents.get(channelId)!;

    if (!this.channelListeners.has(channelId)) {
      this.channelListeners.add(channelId);
      agent.runBackgroundTask((signal) =>
        this.agentEventLoop(channelId, agent, signal),
      );
    }

    return agent;
  }

  private async agentEventLoop(
    channelId: string,
    agent: Agent,
    signal: AbortSignal,
  ): Promise<void> {
    const eventCursor = agent
      .getState(AgentEventState)
      .getEventCursorFromCurrentPosition();
    try {
      for await (const state of agent.subscribeStateAsync(
        AgentEventState,
        signal,
      )) {
        for (const event of state.yieldEventsByCursor(eventCursor)) {
          switch (event.type) {
            case "output.chat": {
              for (const req of this.activeRequests.values()) {
                if (req.channelId === channelId) req.responseSent = true;
              }
              this.handleChatOutput(channelId, event.message);
              break;
            }
            case "output.info":
            case "output.warning":
            case "output.error": {
              for (const req of this.activeRequests.values()) {
                if (req.channelId === channelId) req.responseSent = true;
              }
              this.handleChatOutput(
                channelId,
                `\n[${event.type.split(".")[1].toUpperCase()}]: ${event.message}\n`,
              );
              break;
            }
            case "agent.response": {
              const request = this.activeRequests.get(event.requestId);
              if (request) {
                const response = this.chatResponses.get(request.channelId);
                if (response) {
                  response.isComplete = true;
                  await this.flushBuffer(request.channelId);
                }

                if (!request.responseSent) {
                  await this.app.client.chat.postMessage({
                    channel: request.channelId,
                    text: "No response received from agent.",
                  });
                }
                this.activeRequests.delete(event.requestId);
              }
              break;
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        this.tokenRingApp.serviceError(
          this.slackService,
          "Error in channel listener:",
          error,
        );
      }
    } finally {
      this.channelListeners.delete(channelId);
    }
  }

  private handleChatOutput(channelId: string, content: string): void {
    const response = this.chatResponses.get(channelId);
    if (!response)
      throw new Error(`No response found for channel ${channelId}`);

    if (response.text === null) response.text = "";
    response.text += content;

    this.pendingChannelIds.add(channelId);
    this.scheduleSend();
  }

  private scheduleSend(): void {
    if (this.sendTimer !== null || this.isProcessing) return;
    const now = Date.now();
    const delay = Math.max(0, this.lastSendTime + 250 - now);
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
    const response = this.chatResponses.get(channelId);
    if (!response) return;

    const chunks = splitIntoChunks(response.text);
    let hadErrors = false;

    // If complete, sync all chunks. During streaming, sync only the last 2 chunks.
    const syncFrom = response.isComplete ? 0 : Math.max(0, chunks.length - 2);

    for (let i = syncFrom; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk === response.sentTexts[i]) continue;

      try {
        const existingTs = response.messageTimestamps[i];
        if (existingTs) {
          const updatedTs = await this.updateMessageWithFallback(
            channelId,
            existingTs,
            chunk,
          );
          response.messageTimestamps[i] = updatedTs;
        } else {
          const postedTs = await this.sendMessage(channelId, chunk);
          response.messageTimestamps[i] = postedTs;
        }
        response.sentTexts[i] = chunk;
      } catch (error) {
        hadErrors = true;
        this.tokenRingApp.serviceError(
          this.slackService,
          "Error flushing buffer:",
          error,
        );
      }
    }

    if (response.isComplete && !hadErrors) {
      this.chatResponses.delete(channelId);
    } else if (response.isComplete && hadErrors) {
      this.pendingChannelIds.add(channelId);
      this.scheduleSend();
    }
  }

  private async sendMessage(channelId: string, text: string): Promise<string> {
    const result = await this.app.client.chat.postMessage({
      channel: channelId,
      text,
    });
    if (!result.ts || !result.channel) {
      throw new Error(
        `Slack did not return message timestamp for channel ${channelId}.`,
      );
    }
    this.messageIdToBotUserId.set(
      `${result.channel}-${result.ts}`,
      this.botUserId!,
    );
    return result.ts;
  }

  private async updateMessageWithFallback(
    channelId: string,
    timestamp: string,
    text: string,
  ): Promise<string> {
    try {
      await this.app.client.chat.update({
        channel: channelId,
        ts: timestamp,
        text,
      });
      return timestamp;
    } catch (error) {
      if (!this.isMessageNotFoundError(error)) throw error;
      return this.sendMessage(channelId, text);
    }
  }

  private isMessageNotFoundError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return message.includes("message_not_found");
  }

  getBotUserId(): string | undefined {
    return this.botUserId;
  }
}
