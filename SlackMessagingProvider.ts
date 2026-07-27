import { App, type KnownEventFromType } from "@slack/bolt";
import { type ChatAttachment, ChatAttachmentSchema } from "@tokenring-ai/agent/AgentEvents";
import type TokenRingApp from "@tokenring-ai/app";
import type { IncomingMessage, IncomingMessageHandler, MessagingProvider } from "@tokenring-ai/bot";
import { stripUndefinedKeys } from "@tokenring-ai/utility/object/stripObject";
import type SlackService from "./SlackService.ts";
import type { ResolvedSlackAccountConfig } from "./schema.ts";

/** Slack accepts 4000 characters per message; leave room for formatting. */
const MAX_MESSAGE_LENGTH = 3900;

/** How many of our own message ids to remember, for spotting replies to them. */
const OWN_MESSAGE_HISTORY = 2000;

type SlackAppMentionEvent = KnownEventFromType<"app_mention">;
type SlackMessageEvent = KnownEventFromType<"message">;
type SlackInboundMessage =
  | SlackAppMentionEvent
  | Extract<SlackMessageEvent, { subtype: undefined }>
  | Extract<SlackMessageEvent, { subtype: "file_share" }>
  | Extract<SlackMessageEvent, { subtype: "me_message" }>
  | Extract<SlackMessageEvent, { subtype: "thread_broadcast" }>;

/**
 * One Slack app installation, exposed as a messaging transport. It knows how to
 * carry text and files to and from Slack, and nothing about agents.
 */
export default class SlackMessagingProvider implements MessagingProvider {
  readonly maxMessageLength = MAX_MESSAGE_LENGTH;

  private slackApp!: App;
  private botUserId: string | undefined;
  private handlers = new Set<IncomingMessageHandler>();
  private ownMessages = new Set<string>();

  constructor(
    private readonly app: TokenRingApp,
    private readonly service: SlackService,
    readonly accountName: string,
    private readonly config: ResolvedSlackAccountConfig,
  ) {}

  async start(): Promise<void> {
    this.slackApp = new App(
      stripUndefinedKeys({
        token: this.config.botToken,
        signingSecret: this.config.signingSecret,
        socketMode: !!this.config.appToken,
        appToken: this.config.appToken,
      }),
    );

    const authResult = await this.slackApp.client.auth.test();
    this.botUserId = authResult.user_id;

    this.slackApp.message(async ({ message }) => {
      await this.handleRawMessage(message);
    });

    this.slackApp.event("app_mention", async ({ event }) => {
      await this.handleRawMessage(event);
    });

    await this.slackApp.start();

    this.app.serviceOutput(this.service, `Slack account ${this.accountName} connected as @${authResult.user}`);
  }

  async stop(): Promise<void> {
    this.handlers.clear();
    this.ownMessages.clear();
    try {
      await this.slackApp.stop();
    } catch (error: unknown) {
      this.app.serviceError(this.service, "Error stopping Slack app:", error);
    }
  }

  onMessage(handler: IncomingMessageHandler): void {
    this.handlers.add(handler);
  }

  /** Channel ids address themselves; user ids need an IM channel opened. */
  async resolveConversation(targetId: string): Promise<string> {
    if (!/^[UW]/.test(targetId)) return targetId;

    const result = await this.slackApp.client.conversations.open({ users: targetId });
    const channelId = result.channel?.id;
    if (!channelId) throw new Error(`Slack did not return a DM channel for user ${targetId}.`);
    return channelId;
  }

  async sendMessage(conversationId: string, text: string): Promise<string> {
    const result = await this.slackApp.client.chat.postMessage({ channel: conversationId, text });
    if (!result.ts) {
      throw new Error(`Slack did not return a message timestamp for channel ${conversationId}.`);
    }
    this.rememberOwnMessage(conversationId, result.ts);
    return result.ts;
  }

  async updateMessage(conversationId: string, messageId: string, text: string): Promise<string> {
    try {
      await this.slackApp.client.chat.update({ channel: conversationId, ts: messageId, text });
      return messageId;
    } catch (error: unknown) {
      if (!isMessageNotFoundError(error)) throw error;
      return this.sendMessage(conversationId, text);
    }
  }

  private isInboundMessage(msg: SlackMessageEvent | SlackAppMentionEvent): msg is SlackInboundMessage {
    return (
      msg.type === "app_mention" ||
      msg.subtype === undefined ||
      msg.subtype === "file_share" ||
      msg.subtype === "me_message" ||
      msg.subtype === "thread_broadcast"
    );
  }

  private async handleRawMessage(msg: SlackMessageEvent | SlackAppMentionEvent): Promise<void> {
    try {
      if (!this.isInboundMessage(msg)) return;

      const userId = msg.user;
      const conversationId = msg.channel;
      if (!userId || !conversationId || ("bot_id" in msg && msg.bot_id)) return;

      const rawText = msg.text ?? "";
      const mentioned = !!this.botUserId && rawText.includes(`<@${this.botUserId}>`);
      const threadTs = "thread_ts" in msg ? msg.thread_ts : undefined;
      const repliedTo = !!threadTs && this.ownMessages.has(messageKey(conversationId, threadTs));

      const message: IncomingMessage = {
        conversationId,
        userId,
        userName: `<@${userId}>`,
        text: mentioned ? rawText.replace(/<@[^>]+>/g, "").trim() : rawText,
        attachments: await this.extractAllAttachments(msg),
        direct: conversationId.startsWith("D"),
        addressed: conversationId.startsWith("D") || mentioned || repliedTo,
      };

      for (const handler of this.handlers) {
        await handler(message);
      }
    } catch (error: unknown) {
      this.app.serviceError(this.service, "Error processing Slack message:", error);
    }
  }

  private async extractAllAttachments(msg: SlackInboundMessage): Promise<ChatAttachment[]> {
    const attachments: ChatAttachment[] = [];
    const files = "files" in msg ? (msg.files ?? []) : [];

    for (const file of files) {
      if (file.size && file.size > this.config.maxFileSize) {
        this.app.serviceOutput(this.service, `Slack file ${file.id} exceeded maxFileSize (${file.size} bytes), skipping.`);
        continue;
      }

      const fileUrl = file.url_private_download ?? file.url_private;
      if (!fileUrl) continue;

      try {
        const response = await fetch(fileUrl, {
          headers: { Authorization: `Bearer ${this.config.botToken}` },
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.statusText}`);
        }

        const data = await response.arrayBuffer();
        attachments.push({
          name: file.name || `slack_file_${file.id}`,
          mimeType: ChatAttachmentSchema.shape.mimeType.parse(file.mimetype),
          body: Buffer.from(data as ArrayBuffer).toString("base64"),
          encoding: "base64",
        });
      } catch (error: unknown) {
        this.app.serviceError(this.service, `Failed to fetch Slack file ${file.id}:`, error);
      }
    }

    return attachments;
  }

  private rememberOwnMessage(conversationId: string, ts: string): void {
    this.ownMessages.add(messageKey(conversationId, ts));
    if (this.ownMessages.size > OWN_MESSAGE_HISTORY) {
      const oldest = this.ownMessages.values().next().value;
      if (oldest) this.ownMessages.delete(oldest);
    }
  }
}

function messageKey(conversationId: string, ts: string): string {
  return `${conversationId}-${ts}`;
}

function isMessageNotFoundError(error: unknown): boolean {
  return Error.isError(error) && error.message.toLowerCase().includes("message_not_found");
}
