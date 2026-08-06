import { CommandFailedError } from "@tokenring-ai/agent/AgentError";
import type { AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand } from "@tokenring-ai/agent/types";
import { type ConfigLayer, ConfigurationService } from "@tokenring-ai/app";

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
      description: "The Slack bot OAuth token (xoxb-...)",
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
    if (!agent.headless) {
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
    }

    if (!botToken || !signingSecret) {
      throw new CommandFailedError("Usage: /connect slack <botToken> <signingSecret> [appToken]");
    }

    const configService = agent.requireService(ConfigurationService);
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
            botToken,
            signingSecret,
            ...(appToken && { appToken }),
          },
        },
      },
    } satisfies ConfigLayer;

    const result = await configService.apply(save, next);
    if (!result.ok) {
      throw new CommandFailedError(result.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("\n"));
    }

    return `Slack account "${name}" connected.`;
  },
  help: `Connect a Slack app installation and save its credentials in the configuration.

When run interactively, credentials are requested using masked prompts. The app-level
token is optional and enables Socket Mode.

## Example

/connect slack --name=slack`,
} satisfies TokenRingAgentCommand<typeof inputSchema>;
