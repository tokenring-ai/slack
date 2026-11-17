import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { App } from "@slack/bolt";
import type TokenRingApp from "@tokenring-ai/app";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import type { ChannelMembership, IncomingMessage } from "@tokenring-ai/bot";
import { BotService } from "@tokenring-ai/bot";
import SlackService from "./SlackService";
import type { ResolvedSlackServiceConfig } from "./schema";

/** Handlers the service registers with bolt, so tests can feed events in. */
let messageHandler: (args: any) => Promise<void>;
let eventHandlers: Record<string, (args: any) => Promise<void>>;

void mock.module("@slack/bolt", () => {
  const mockClient: any = {
    auth: {
      test: mock().mockResolvedValue({ user_id: "UBOT123", user: "test-bot", team_id: "T123" }),
    },
    chat: {
      postMessage: mock().mockResolvedValue({ channel: "C123", ts: "1234567890.123456", ok: true }),
      update: mock().mockResolvedValue({ ok: true, ts: "1234567890.123456" }),
    },
    conversations: {
      open: mock().mockResolvedValue({ channel: { id: "D999" }, ok: true }),
      info: mock().mockResolvedValue({ channel: { id: "C123", name: "engineering" }, ok: true }),
    },
  };

  return {
    App: mock().mockImplementation(() => ({
      command: mock(),
      event: mock().mockImplementation((name: string, handler: (args: any) => Promise<void>) => {
        eventHandlers[name] = handler;
      }),
      message: mock().mockImplementation((handler: (args: any) => Promise<void>) => {
        messageHandler = handler;
      }),
      start: mock().mockResolvedValue(undefined),
      stop: mock().mockResolvedValue(undefined),
      client: mockClient,
    })),
  };
});

const config: ResolvedSlackServiceConfig = {
  accounts: {
    workspace: {
      botToken: "xoxb-test-token",
      signingSecret: "test-signing-secret",
      appToken: "xapp-test-token",
      maxFileSize: 20_971_520,
    },
  },
};

describe("Slack Integration Tests", () => {
  let app: TokenRingApp;
  let botService: BotService;
  let slackService: SlackService;

  beforeEach(async () => {
    mock.clearAllMocks();
    eventHandlers = {};

    app = createTestingApp();
    botService = new BotService(app);
    app.addService(BotService, botService);

    slackService = new SlackService(app);
    await slackService.reconfigure(config);
  });

  it("connects each configured account with its credentials", async () => {
    expect(App).toHaveBeenCalledWith({
      token: "xoxb-test-token",
      signingSecret: "test-signing-secret",
      socketMode: true,
      appToken: "xapp-test-token",
    });
    expect((App as any).mock.results[0].value.start).toHaveBeenCalled();
    expect(slackService.getAvailableAccounts()).toEqual(["workspace"]);
  });

  it("registers each account with the bot service under its own name", async () => {
    expect(botService.getProviderNames()).toEqual(["workspace"]);
  });

  it("disconnects and deregisters accounts on shutdown", async () => {
    await slackService.stop();

    expect((App as any).mock.results[0].value.stop).toHaveBeenCalled();
    expect(botService.getProviderNames()).toEqual([]);
    expect(slackService.getAvailableAccounts()).toEqual([]);
  });

  describe("inbound messages", () => {
    let received: IncomingMessage[];

    beforeEach(async () => {
      received = [];
      slackService.getProvider("workspace")!.onMessage(message => {
        received.push(message);
      });
    });

    it("normalizes a channel mention, stripping the mention from the text", async () => {
      await messageHandler({ message: { type: "message", user: "U123", channel: "C123", ts: "1.1", text: "<@UBOT123> deploy please" } });

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        conversationId: "C123",
        userId: "U123",
        text: "deploy please",
        direct: false,
        addressed: true,
      });
    });

    it("marks messages in a DM channel as direct", async () => {
      await messageHandler({ message: { type: "message", user: "U123", channel: "D123", ts: "1.1", text: "hello" } });

      expect(received[0]).toMatchObject({ direct: true, addressed: true });
    });

    it("does not treat an unaddressed channel message as addressed", async () => {
      await messageHandler({ message: { type: "message", user: "U123", channel: "C123", ts: "1.1", text: "chatting amongst ourselves" } });

      expect(received[0]).toMatchObject({ addressed: false });
    });

    it("ignores messages the bot itself posted", async () => {
      await messageHandler({ message: { type: "message", bot_id: "B1", user: "UBOT123", channel: "C123", ts: "1.1", text: "hi" } });

      expect(received).toEqual([]);
    });

    it("strips its own mention but leaves the people the message names", async () => {
      await messageHandler({ message: { type: "message", user: "U123", channel: "C123", ts: "1.1", text: "<@UBOT123> ask <@U456> about the deploy" } });

      expect(received[0]).toMatchObject({ text: "ask <@U456> about the deploy", addressed: true });
    });

    it("carries the thread a message arrived in, so the answer can go back to it", async () => {
      await messageHandler({ message: { type: "message", user: "U123", channel: "C123", ts: "2.2", thread_ts: "1.1", text: "<@UBOT123> and this?" } });

      expect(received[0]).toMatchObject({ conversationId: "C123", messageId: "2.2", replyToMessageId: "1.1" });
    });
  });

  describe("channel membership", () => {
    let memberships: ChannelMembership[];

    beforeEach(() => {
      memberships = [];
      slackService.getProvider("workspace")!.onMembershipChange?.(event => {
        memberships.push(event);
      });
    });

    it("reports being added to a channel, with the name and who invited it", async () => {
      await eventHandlers.member_joined_channel!({ event: { type: "member_joined_channel", user: "UBOT123", channel: "C123", inviter: "U123" } });

      expect(memberships).toMatchObject([{ conversationId: "C123", title: "engineering", joined: true, byUserId: "U123", via: "invite" }]);
    });

    it("ignores everyone else joining the channels it watches", async () => {
      await eventHandlers.member_joined_channel!({ event: { type: "member_joined_channel", user: "U456", channel: "C123", inviter: "U123" } });

      expect(memberships).toEqual([]);
    });

    it("reports leaving, so a channel it was kicked from stops being offered", async () => {
      await eventHandlers.member_left_channel!({ event: { type: "member_left_channel", user: "UBOT123", channel: "C123" } });

      expect(memberships).toMatchObject([{ conversationId: "C123", joined: false, via: "invite" }]);
    });

    it("reports a channel it was already in on the first message out of it, once", async () => {
      await messageHandler({ message: { type: "message", user: "U123", channel: "C123", ts: "1.1", text: "hello" } });
      await messageHandler({ message: { type: "message", user: "U123", channel: "C123", ts: "1.2", text: "again" } });

      // `observed` never triggers an automatic join — nobody invited it just now.
      expect(memberships).toMatchObject([{ conversationId: "C123", title: "engineering", joined: true, via: "observed" }]);
    });

    it("does not report DM channels as rooms it could be joined to", async () => {
      await messageHandler({ message: { type: "message", user: "U123", channel: "D123", ts: "1.1", text: "hello" } });

      expect(memberships).toEqual([]);
    });
  });

  describe("outbound messages", () => {
    it("posts to a channel and returns the message timestamp", async () => {
      const provider = slackService.getProvider("workspace")!;

      await expect(provider.sendMessage("C123", "hello")).resolves.toBe("1234567890.123456");
    });

    it("treats a thread it has answered in as one it is listening to", async () => {
      const provider = slackService.getProvider("workspace")!;
      const received: IncomingMessage[] = [];
      provider.onMessage(message => {
        received.push(message);
      });

      // Unaddressed and in a thread the bot has said nothing in: not for it.
      await messageHandler({ message: { type: "message", user: "U123", channel: "C123", ts: "2.2", thread_ts: "1.1", text: "chatting" } });
      expect(received[0]).toMatchObject({ addressed: false });

      await provider.sendMessage("C123", "answering", { replyToMessageId: "1.1" });

      await messageHandler({ message: { type: "message", user: "U123", channel: "C123", ts: "3.3", thread_ts: "1.1", text: "and one more thing" } });
      expect(received[1]).toMatchObject({ addressed: true });
    });

    it("opens a DM channel when addressed to a user", async () => {
      const provider = slackService.getProvider("workspace")!;

      await expect(provider.resolveConversation("U123")).resolves.toBe("D999");
      await expect(provider.resolveConversation("C123")).resolves.toBe("C123");
    });
  });
  describe("redelivery", () => {
    it("handles a channel mention once though it arrives as both a message and an app_mention", async () => {
      const received: IncomingMessage[] = [];
      slackService.getProvider("workspace")!.onMessage(message => {
        received.push(message);
      });
      const event = { user: "U123", channel: "C123", ts: "5.5", text: "<@UBOT123> deploy please" };

      await Promise.all([messageHandler({ message: { type: "message", ...event } }), eventHandlers.app_mention!({ event: { type: "app_mention", ...event } })]);
      // Socket Mode redelivery of the same event later is dropped too.
      await messageHandler({ message: { type: "message", ...event } });

      expect(received).toHaveLength(1);
    });

    it("still handles the same ts in a different channel", async () => {
      const received: IncomingMessage[] = [];
      slackService.getProvider("workspace")!.onMessage(message => {
        received.push(message);
      });

      await messageHandler({ message: { type: "message", user: "U123", channel: "C123", ts: "5.5", text: "a" } });
      await messageHandler({ message: { type: "message", user: "U123", channel: "C456", ts: "5.5", text: "b" } });

      expect(received).toHaveLength(2);
    });
  });

  describe("edit fallback", () => {
    it("re-posts into the thread when the message being edited is gone", async () => {
      const provider = slackService.getProvider("workspace")!;
      const client = (App as any).mock.results[0].value.client;

      const ts = await provider.sendMessage("C123", "partial", { replyToMessageId: "1.1" });
      client.chat.update.mockRejectedValueOnce(new Error("An API error occurred: message_not_found"));
      await provider.updateMessage("C123", ts, "partial and more");

      expect(client.chat.postMessage).toHaveBeenLastCalledWith({ channel: "C123", text: "partial and more", thread_ts: "1.1" });
    });

    it("re-posts to the channel root when the lost message was not threaded", async () => {
      const provider = slackService.getProvider("workspace")!;
      const client = (App as any).mock.results[0].value.client;

      const ts = await provider.sendMessage("C123", "partial");
      client.chat.update.mockRejectedValueOnce(new Error("An API error occurred: message_not_found"));
      await provider.updateMessage("C123", ts, "partial and more");

      expect(client.chat.postMessage).toHaveBeenLastCalledWith({ channel: "C123", text: "partial and more" });
    });
  });

  describe("attachment size", () => {
    let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">>;

    afterEach(() => {
      fetchSpy?.mockRestore();
    });

    async function attachmentsFor(body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
      await slackService.reconfigure({ accounts: { workspace: { ...config.accounts.workspace!, maxFileSize: 10 } } });
      const received: IncomingMessage[] = [];
      slackService.getProvider("workspace")!.onMessage(message => {
        received.push(message);
      });
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { headers }));

      // No `size`: the declared size cannot be relied on to enforce the cap.
      const file = { id: "F1", name: "pic.png", mimetype: "image/png", url_private: "https://files.slack.test/F1" };
      await messageHandler({ message: { type: "message", subtype: "file_share", user: "U123", channel: "D123", ts: "7.7", text: "", files: [file] } });
      return received[0]!.attachments!();
    }

    function streamOf(chunks: number[], pulled: { count: number }) {
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          const size = chunks[pulled.count++];
          if (size === undefined) controller.close();
          else controller.enqueue(new Uint8Array(size));
        },
      });
    }

    it("stops downloading a file with no declared size once it passes maxFileSize", async () => {
      const pulled = { count: 0 };
      const attachments = await attachmentsFor(streamOf([6, 6, 6, 6, 6, 6], pulled));

      expect(attachments).toEqual([]);
      expect(pulled.count).toBeLessThan(6);
    });

    it("skips a file whose Content-Length is over maxFileSize", async () => {
      const pulled = { count: 0 };
      const attachments = await attachmentsFor(streamOf([6], pulled), { "content-length": "100" });

      expect(attachments).toEqual([]);
    });

    it("keeps a file within maxFileSize", async () => {
      const pulled = { count: 0 };
      const attachments = await attachmentsFor(streamOf([4, 4], pulled));

      expect(attachments).toMatchObject([{ name: "pic.png", mimeType: "image/png", encoding: "base64" }]);
      expect(Buffer.from(attachments[0]!.body, "base64")).toHaveLength(8);
    });
  });

  describe("start failure", () => {
    it("stops the app when auth.test fails", async () => {
      const client = (App as any).mock.results[0].value.client;
      client.auth.test.mockRejectedValueOnce(new Error("invalid_auth"));

      await expect(
        slackService.reconfigure({ accounts: { ...config.accounts, other: { ...config.accounts.workspace!, botToken: "xoxb-bad" } } }),
      ).rejects.toThrow("invalid_auth");

      const failed = (App as any).mock.results.at(-1).value;
      expect(failed.start).not.toHaveBeenCalled();
      expect(failed.stop).toHaveBeenCalled();
    });

    it("stops the app when it fails to start, so no socket stays open", async () => {
      const impl = (App as any).getMockImplementation();
      (App as any).mockImplementationOnce((...args: unknown[]) => {
        const instance = impl(...args);
        instance.start = mock().mockRejectedValue(new Error("socket refused"));
        return instance;
      });

      await expect(
        slackService.reconfigure({ accounts: { ...config.accounts, other: { ...config.accounts.workspace!, botToken: "xoxb-bad" } } }),
      ).rejects.toThrow("socket refused");

      expect((App as any).mock.results.at(-1).value.stop).toHaveBeenCalled();
      expect(slackService.getAvailableAccounts()).toEqual(["workspace"]);
    });
  });
});
