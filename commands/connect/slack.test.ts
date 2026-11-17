import { describe, expect, it } from "bun:test";
import { createConnectHarness } from "@tokenring-ai/secrets/test/connectHarness";
import { VAULT_LOCKED_MESSAGE } from "@tokenring-ai/secrets/vaultCredentials";
import command from "./slack.ts";

const BOT = "xoxb-secret-bot";
const SIGNING = "signing-secret-value";
const APP = "xapp-secret-app";

function run(harness: ReturnType<typeof createConnectHarness>, args: Record<string, unknown> = {}) {
  return command.execute({ agent: harness.agent, args: { name: "work", save: "workspace", ...args } } as never);
}

describe("/connect slack", () => {
  it("saves the credentials to the vault and only references them in settings", async () => {
    const harness = createConnectHarness({ answers: [BOT, SIGNING, APP] });
    const output = await run(harness);

    expect(harness.prompts.every(prompt => prompt.masked)).toBe(true);
    expect(harness.vault.entries.slack).toEqual({ "work.botToken": BOT, "work.signingSecret": SIGNING, "work.appToken": APP });
    expect(harness.configuration.overrides.workspace).toEqual({
      slack: {
        accounts: {
          work: {
            botToken: { source: "vault", category: "slack", key: "work.botToken" },
            signingSecret: { source: "vault", category: "slack", key: "work.signingSecret" },
            appToken: { source: "vault", category: "slack", key: "work.appToken" },
          },
        },
      },
    });
    for (const value of [BOT, SIGNING, APP]) {
      expect(harness.settingsContain(value)).toBe(false);
      expect(output).not.toContain(value);
    }
  });

  it("skips the optional app token", async () => {
    const harness = createConnectHarness({ answers: [BOT, SIGNING, ""] });
    await run(harness);
    expect(Object.keys(harness.vault.entries.slack!)).toEqual(["work.botToken", "work.signingSecret"]);
    expect(harness.configuration.overrides.workspace).not.toHaveProperty("slack.accounts.work.appToken");
  });

  it("refuses when the vault is locked, saving nothing and asking for nothing", async () => {
    const harness = createConnectHarness({ answers: [BOT, SIGNING, APP] });
    harness.vault.writable = false;
    await expect(run(harness)).rejects.toThrow(VAULT_LOCKED_MESSAGE);
    expect(harness.prompts).toEqual([]);
    expect(harness.vault.entries).toEqual({});
    expect(harness.configuration.overrides.workspace).toEqual({});
  });

  it("puts the vault back when the settings can't be saved", async () => {
    const harness = createConnectHarness();
    harness.vault.entries.slack = { "work.botToken": "previous-bot" };
    harness.configuration.reject = "invalid";
    const error = await run(harness, { botToken: BOT, signingSecret: SIGNING, appToken: APP }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    for (const value of [BOT, SIGNING, APP]) expect((error as Error).message).not.toContain(value);
    expect(harness.vault.entries.slack).toEqual({ "work.botToken": "previous-bot" });
    expect(harness.configuration.overrides.workspace).toEqual({});
  });
});
