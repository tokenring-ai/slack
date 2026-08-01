import { beforeEach, describe, expect, it, mock } from "bun:test";
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
    app.addService(botService);

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
});
