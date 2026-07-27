# @tokenring-ai/slack

## Overview

Slack transport for TokenRing bots. This package connects Slack app installations and hands each one to
[`@tokenring-ai/bot`](../bot) as a messaging provider — it carries text and files to and from Slack, and nothing else.

Who a bot talks to, which channels it sits in, and which agent answers are configured on the bot, not here. See the
`@tokenring-ai/bot` README for that half.

### Key Features

- **Multiple workspaces**: run any number of Slack app installations side by side
- **Socket Mode**: no public HTTP endpoint required when an app-level token is configured
- **Streaming edits**: messages are edited in place as an agent's response grows
- **DM channels on demand**: a user id is resolved to an IM channel automatically
- **Attachments**: shared files are fetched and passed to the agent, within a configurable size limit

## Installation

```bash
bun add @tokenring-ai/slack
```

Create a Slack app with the `app_mentions:read`, `channels:history`, `chat:write`, `files:read`, `im:history`, and
`im:write` scopes, and enable Socket Mode if you want to run without a public endpoint.

## Configuration

```yaml
slack:
  accounts:
    slack:                          # the service name bots address, e.g. slack:U123ABC
      botToken: { source: env, env: SLACK_BOT_TOKEN }
      appToken: { source: env, env: SLACK_APP_TOKEN }
      signingSecret: { source: env, env: SLACK_SIGNING_SECRET }
      maxFileSize: 20971520
```

| Option          | Type     | Default      | Description                                             |
|-----------------|----------|--------------|---------------------------------------------------------|
| `botToken`      | `secret` | required     | Bot OAuth token (`xoxb-...`)                            |
| `signingSecret` | `secret` | required     | Request signing secret                                  |
| `appToken`      | `secret` | —            | App-level token (`xapp-...`); enables Socket Mode       |
| `maxFileSize`   | `number` | `20971520`   | Largest file, in bytes, fetched from Slack              |

Then point a bot at it:

```yaml
bot:
  bots:
    helper:
      agentType: assistant
      users:
        "slack:U123ABC": admin
      channels:
        engineering:
          target: slack:C0123ABCD
```

Invite the bot to any channel you list, or it will not receive messages there.

### ENV Variables

This package does not read environment variables directly — point the secrets at them with
`{ source: env, env: ... }`.

## Chat Commands

This package does not define any chat commands. See `@tokenring-ai/bot` for `/message` and `/bots`.

## Tools

This package does not define any tools.

## License

MIT License - see LICENSE file for details.

---

## Developer Reference

### SlackService

Connects every configured account at startup and registers each one with `BotService` under its account name.
Disconnects and deregisters them on shutdown.

| Method                    | Description                          |
|---------------------------|--------------------------------------|
| `getAvailableAccounts()`  | Names of the connected accounts      |
| `getProvider(name)`       | The provider for an account          |

### SlackMessagingProvider

Implements `MessagingProvider` from `@tokenring-ai/bot` for one app installation:

- `maxMessageLength` is 3900, under Slack's 4000 character limit
- `resolveConversation` opens an IM channel for user ids (`U…`/`W…`) and passes channel ids through unchanged
- `updateMessage` edits in place, posting a fresh message if the original has gone
- inbound messages are marked `addressed` when they are a DM, mention the bot, or reply in a thread the bot started

### Package Structure

```text
plugin/slack/
├── index.ts                    # Main exports
├── plugin.ts                   # Plugin definition for TokenRing integration
├── SlackService.ts             # Connects accounts, registers them with BotService
├── SlackMessagingProvider.ts   # The Slack transport
├── schema.ts                   # Configuration schemas
├── integration.test.ts         # Service and transport tests
└── LICENSE                     # MIT License
```

### Dependencies

| Package                 | Description                       |
|-------------------------|-----------------------------------|
| `@tokenring-ai/bot`     | Bot service and provider contract |
| `@tokenring-ai/agent`   | Attachment types                  |
| `@tokenring-ai/app`     | Application framework             |
| `@tokenring-ai/secrets` | Secret resolution                 |
| `@slack/bolt`           | Slack app framework               |

### Testing

```bash
bun test
```
