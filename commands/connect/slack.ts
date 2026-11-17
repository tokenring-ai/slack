import { CommandFailedError } from "@tokenring-ai/agent/AgentError";
import type { AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand } from "@tokenring-ai/agent/types";
import { type ConfigLayer, ConfigurationService } from "@tokenring-ai/app";
import SecretService from "@tokenring-ai/secrets/SecretService";
import type { SecretVaultRef } from "@tokenring-ai/secrets/secret";
import { accountCredentialRef, saveToVaultThen, VAULT_LOCKED_MESSAGE } from "@tokenring-ai/secrets/vaultCredentials";

const inputSchema = {
  args: {
    name: {
      description: "The name to save the Slack account under",
      type: "string",
      defaultValue: "slack",
    },
    save: {
      description: "Where to save the Slack account configuration",
      type: "enum",
      values: ["global", "workspace"],
      defaultValue: "workspace",
    },
  },
  positionals: [
    {
      name: "botToken",
      description: "The Slack bot OAuth token (xoxb-...). Typed inline it stays in the chat history; omit it to use a masked prompt",
      required: false,
    },
    {
      name: "signingSecret",
      description: "The Slack app signing secret",
      required: false,
    },
    {
      name: "appToken",
      description: "The Slack app-level token for Socket Mode (xapp-...)",
      required: false,
    },
  ],
} as const satisfies AgentCommandInputSchema;

export default {
  name: "connect slack",
  alias: "slack connect",
  description: "Connects a Slack app installation",
  inputSchema,
  execute: async ({ agent, args: { botToken, signingSecret, appToken, name, save } }: AgentCommandInputType<typeof inputSchema>): Promise<string> => {
    const secrets = agent.requireService(SecretService);
    if (!secrets.canStore()) throw new CommandFailedError(VAULT_LOCKED_MESSAGE);

    botToken ??=
      (await agent.askForText({
        message: "What is the bot OAuth token for the Slack app you want to connect?",
        label: "Bot OAuth Token",
        masked: true,
      })) ?? undefined;
    signingSecret ??=
      (await agent.askForText({
        message: "What is the signing secret for the Slack app?",
        label: "Signing Secret",
        masked: true,
      })) ?? undefined;
    appToken ??=
      (await agent.askForText({
        message: "What is the app-level token for Socket Mode? Leave blank to skip it.",
        label: "App-Level Token (optional)",
        masked: true,
      })) || undefined;

    if (!botToken || !signingSecret) {
      throw new CommandFailedError("Usage: /connect slack <botToken> <signingSecret> [appToken]");
    }

    const credentials: [SecretVaultRef, string][] = [
      [accountCredentialRef("slack", name, "botToken"), botToken],
      [accountCredentialRef("slack", name, "signingSecret"), signingSecret],
    ];
    if (appToken) credentials.push([accountCredentialRef("slack", name, "appToken"), appToken]);
    const [botTokenRef, signingSecretRef, appTokenRef] = credentials.map(([ref]) => ref);

    const configService = agent.requireService(ConfigurationService);
    await saveToVaultThen(secrets, credentials, async () => {
      const overrides = configService.getOverrides(save);
      const slack = (overrides.slack ?? {}) as { accounts?: Record<string, unknown> };
      const accounts = slack.accounts ?? {};
      const existingAccount = (accounts[name] ?? {}) as Record<string, unknown>;
      const next = {
        ...overrides,
        slack: {
          ...slack,
          accounts: {
            ...accounts,
            [name]: {
              ...existingAccount,
              botToken: botTokenRef,
              signingSecret: signingSecretRef,
              ...(appTokenRef && { appToken: appTokenRef }),
            },
          },
        },
      } satisfies ConfigLayer;

      const result = await configService.apply(save, next);
      if (!result.ok) {
        throw new CommandFailedError(result.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("\n"));
      }
    });

    return `Slack account "${name}" connected. Its credentials are in the vault under slack/${name}.*.`;
  },
  help: `Connect a Slack app installation. The credentials are saved in the vault (category
"slack", keys "<name>.botToken", "<name>.signingSecret" and "<name>.appToken"), and the
configuration only references them. The vault must be unlocked.

When run interactively, credentials are requested using masked prompts. Passing them as
arguments also works (where nobody can answer the prompts), but then they stay in the chat history. The
app-level token is optional and enables Socket Mode.

## Example

/connect slack --name=slack`,
} satisfies TokenRingAgentCommand<typeof inputSchema>;
