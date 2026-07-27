import { beforeEach, describe, expect, it, mock } from "bun:test";
import { App } from "@slack/bolt";
import type TokenRingApp from "@tokenring-ai/app";
import createTestingApp from "@tokenring-ai/app/test/createTestingApp.test";
import type { IncomingMessage } from "@tokenring-ai/bot";
import { BotService } from "@tokenring-ai/bot";
import SlackService from "./SlackService";
import type { ResolvedSlackServiceConfig } from "./schema";

const mockWaitForAbort = mock();
void mock.module("@tokenring-ai/utility/promise/waitForAbort", () => ({
  default: (...args: any[]) => mockWaitForAbort(...args),
}));

/** Handlers the service registers with bolt, so tests can feed events in. */
let messageHandler: (args: any) => Promise<void>;

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
    },
  };

  return {
    App: mock().mockImplementation(() => ({
      command: mock(),
      event: mock(),
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

  beforeEach(() => {
    mock.clearAllMocks();

    app = createTestingApp();
    botService = new BotService(app);
    app.addServices(botService);

    slackService = new SlackService(app, config);
  });

  it("connects each configured account with its credentials", async () => {
    await slackService.run({ aborted: false } as AbortSignal);

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
    await slackService.run({ aborted: false } as AbortSignal);

    expect(botService.getProviderNames()).toEqual(["workspace"]);
  });

  it("disconnects and deregisters accounts on shutdown", async () => {
    await slackService.run({ aborted: false } as AbortSignal);

    const abortCallback = mockWaitForAbort.mock.calls[0]?.[1];
    await abortCallback!();

    expect((App as any).mock.results[0].value.stop).toHaveBeenCalled();
    expect(botService.getProviderNames()).toEqual([]);
    expect(slackService.getAvailableAccounts()).toEqual([]);
  });

  describe("inbound messages", () => {
    let received: IncomingMessage[];

    beforeEach(async () => {
      await slackService.run({ aborted: false } as AbortSignal);
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
  });

  describe("outbound messages", () => {
    beforeEach(async () => {
      await slackService.run({ aborted: false } as AbortSignal);
    });

    it("posts to a channel and returns the message timestamp", async () => {
      const provider = slackService.getProvider("workspace")!;

      await expect(provider.sendMessage("C123", "hello")).resolves.toBe("1234567890.123456");
    });

    it("opens a DM channel when addressed to a user", async () => {
      const provider = slackService.getProvider("workspace")!;

      await expect(provider.resolveConversation("U123")).resolves.toBe("D999");
      await expect(provider.resolveConversation("C123")).resolves.toBe("C123");
    });
  });
});
