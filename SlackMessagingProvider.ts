import { App, type KnownEventFromType } from "@slack/bolt";
import { type ChatAttachment, ChatAttachmentSchema } from "@tokenring-ai/agent/AgentEvents";
import type TokenRingApp from "@tokenring-ai/app";
import type { IncomingMessage, IncomingMessageHandler, MembershipHandler, MessagingProvider, SendOptions } from "@tokenring-ai/bot";
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
  private membershipHandlers = new Set<MembershipHandler>();
  private ownMessages = new Set<string>();
  /** Channels we have already reported, so first-sight is reported once. */
  private reportedChannels = new Set<string>();

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

    this.slackApp.event("member_joined_channel", async ({ event }) => {
      await this.handleMembershipEvent(event.channel, true, event.user, event.inviter);
    });

    this.slackApp.event("member_left_channel", async ({ event }) => {
      await this.handleMembershipEvent(event.channel, false, event.user);
    });

    await this.slackApp.start();

    this.app.serviceOutput(this.service, `Slack account ${this.accountName} connected as @${authResult.user}`);
  }

  async stop(): Promise<void> {
    this.handlers.clear();
    this.membershipHandlers.clear();
    this.ownMessages.clear();
    this.reportedChannels.clear();
    try {
      await this.slackApp.stop();
    } catch (error: unknown) {
      this.app.serviceError(this.service, "Error stopping Slack app:", error);
    }
  }

  onMessage(handler: IncomingMessageHandler): void {
    this.handlers.add(handler);
  }

  onMembershipChange(handler: MembershipHandler): void {
    this.membershipHandlers.add(handler);
  }

  /** Channel ids address themselves; user ids need an IM channel opened. */
  async resolveConversation(targetId: string): Promise<string> {
    if (!/^[UW]/.test(targetId)) return targetId;

    const result = await this.slackApp.client.conversations.open({ users: targetId });
    const channelId = result.channel?.id;
    if (!channelId) throw new Error(`Slack did not return a DM channel for user ${targetId}.`);
    return channelId;
  }

  async sendMessage(conversationId: string, text: string, options?: SendOptions): Promise<string> {
    const result = await this.slackApp.client.chat.postMessage({
      channel: conversationId,
      text,
      ...(options?.replyToMessageId ? { thread_ts: options.replyToMessageId } : {}),
    });
    if (!result.ts) {
      throw new Error(`Slack did not return a message timestamp for channel ${conversationId}.`);
    }
    this.rememberOwnMessage(conversationId, result.ts);
    // A thread the bot has spoken in is one it is listening to, so a follow-up
    // there counts as addressed without having to mention it again.
    if (options?.replyToMessageId) this.rememberOwnMessage(conversationId, options.replyToMessageId);
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

      const direct = conversationId.startsWith("D");
      if (!direct) await this.reportChannelOnFirstSight(conversationId);

      const rawText = msg.text ?? "";
      // Only the bot's own mention is stripped; the others name real people the
      // agent needs to see it was asked about.
      const ownMention = this.botUserId ? new RegExp(`<@${this.botUserId}(\\|[^>]*)?>`, "g") : undefined;
      const mentioned = ownMention?.test(rawText) ?? false;
      if (ownMention) ownMention.lastIndex = 0;

      const threadTs = "thread_ts" in msg ? msg.thread_ts : undefined;
      const repliedTo = !!threadTs && this.ownMessages.has(messageKey(conversationId, threadTs));
      const hasAttachments = "files" in msg && msg.files.length > 0;

      const message: IncomingMessage = {
        conversationId,
        userId,
        userName: `<@${userId}>`,
        text:
          mentioned && ownMention
            ? rawText
                .replace(ownMention, "")
                .replace(/\s{2,}/g, " ")
                .trim()
            : rawText,
        messageId: msg.ts,
        replyToMessageId: threadTs,
        hasAttachments,
        // Deferred so a message no bot handles never costs a download.
        attachments: hasAttachments ? () => this.extractAllAttachments(msg) : undefined,
        direct,
        addressed: direct || mentioned || repliedTo,
      };

      for (const handler of this.handlers) {
        await handler(message);
      }
    } catch (error: unknown) {
      this.app.serviceError(this.service, "Error processing Slack message:", error);
    }
  }

  /**
   * Slack reports every member joining every channel the app can see; only the
   * app's own comings and goings are membership changes as far as bots care.
   */
  private async handleMembershipEvent(channel: string, joined: boolean, user: string, inviter?: string): Promise<void> {
    try {
      if (!this.botUserId || user !== this.botUserId) return;

      // Logged unconditionally: an operator not using the join flow still needs
      // somewhere to read the channel id from.
      const title = await this.channelName(channel);
      this.app.serviceOutput(
        this.service,
        `Slack account ${this.accountName} was ${joined ? "added to" : "removed from"} ${title ?? "a channel"} (${channel})`,
      );

      if (joined) {
        this.reportedChannels.add(channel);
      } else {
        this.reportedChannels.delete(channel);
      }

      await this.emitMembership({ conversationId: channel, title, joined, byUserId: inviter, via: "invite" });
    } catch (error: unknown) {
      this.app.serviceError(this.service, "Error processing Slack membership event:", error);
    }
  }

  /**
   * A channel the app was already in when the process started never produces a
   * join event, so the first message out of it stands in for one.
   */
  private async reportChannelOnFirstSight(channel: string): Promise<void> {
    if (this.reportedChannels.has(channel)) return;
    this.reportedChannels.add(channel);

    const title = await this.channelName(channel);
    this.app.serviceOutput(this.service, `Slack account ${this.accountName} is in ${title ?? "a channel"} (${channel})`);

    await this.emitMembership({ conversationId: channel, title, joined: true, via: "observed" });
  }

  /** Best effort: a workspace may not have granted the scope that reads names. */
  private async channelName(channel: string): Promise<string | undefined> {
    try {
      const result = await this.slackApp.client.conversations.info({ channel });
      return result.channel?.name;
    } catch {
      return undefined;
    }
  }

  private async emitMembership(event: Parameters<MembershipHandler>[0]): Promise<void> {
    for (const handler of this.membershipHandlers) {
      await handler(event);
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

      // An unsupported type is declined rather than thrown: a .docx is a normal
      // thing to post in a channel, not an error condition.
      const mimeType = ChatAttachmentSchema.shape.mimeType.safeParse(file.mimetype);
      if (!mimeType.success) {
        this.app.serviceOutput(this.service, `Slack file ${file.name ?? file.id} has unsupported type ${file.mimetype}, skipping.`);
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
          mimeType: mimeType.data,
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
