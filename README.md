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
- **Attachments**: fetched only once a bot has decided to handle the message, within a configurable size limit, and
  unsupported file types are declined rather than failing the message
- **Channel discovery**: being added to a channel is reported to the bot service, which can join a bot to it
  automatically
- **Thread-aware**: a question asked in a thread is answered in that thread

## Installation

```bash
bun add @tokenring-ai/slack
```

Create a Slack app with the `app_mentions:read`, `channels:history`, `channels:read`, `chat:write`, `files:read`,
`groups:read`, `im:history`, and `im:write` scopes, subscribe it to the `member_joined_channel` and
`member_left_channel` events, and enable Socket Mode if you want to run without a public endpoint.

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

| Field            | Type     | Required | Default    | Description                                                        |
|------------------|----------|----------|------------|--------------------------------------------------------------------|
| `botToken`       | `secret` | Yes      | —          | Slack bot OAuth token (xoxb-...)                                   |
| `appToken`       | `secret` | No       | —          | Slack app-level token for Socket Mode (xapp-...)                   |
| `signingSecret`  | `secret` | Yes      | —          | Slack request signing secret                                       |
| `maxFileSize`    | `number` | No       | `20971520` | Largest file, in bytes, fetched from Slack                         |

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

### Schema Metadata

| Field         | Meta                                                                                  |
|---------------|---------------------------------------------------------------------------------------|
| `slack`       | `label: "Slack"`, `description: "Slack app installations"`                            |
| `accounts`    | `label: "Accounts"`, `description: "Slack app installations, keyed by the service name bots address them by"` |
| `maxFileSize` | `advanced: true`, `description: "Largest file, in bytes, fetched from Slack"`         |

### Joining a channel

A Slack app cannot add itself to a channel — a person invites it. When that happens this package reports the channel to
`@tokenring-ai/bot`, which lists it under "Discovered channels" in `/bots` and on the Bots dashboard. From there:

- run `/bots join helper slack:C0123ABCD`, or click **Join** on the dashboard, or
- set `joinPolicy` on the bot so it joins by itself when invited — see the `@tokenring-ai/bot` README.

Channel ids are logged when the app is added to a channel or first sees traffic from one, so you can also read one off
the service log and write it into `channels` by hand.

Discovery needs the `channels:read` and `groups:read` scopes to name a channel, and the `member_joined_channel` and
`member_left_channel` event subscriptions to hear about invitations at all. Without the read scopes a channel is still
discovered, just without its name.

### Threads

A bot keeps one agent per channel — Slack threads are too fine-grained to each deserve their own, and splitting on them
would give a thread hanging off the bot's own answer no memory of the question. A reply that arrives in a thread is
answered in that thread rather than in the channel.

### ENV Variables

This package does not read environment variables directly — point the secrets at them with
`{ source: env, env: ... }`.

## Chat Commands

| Command          | Alias            | Description                     |
|------------------|------------------|---------------------------------|
| `connect slack`  | `slack connect`  | Connects a Slack app installation |

Connects a Slack app installation. The credentials are saved in the vault (category `slack`, keys `<name>.botToken`,
`<name>.signingSecret`, `<name>.appToken`) and the configuration only holds `{ source: vault, ... }` references to them,
so the vault must be unlocked. When run interactively, credentials are requested using masked prompts; passing them as
positionals also works (where nobody can answer a prompt) but leaves them in the chat history. The app-level token is optional and
enables Socket Mode.

**Arguments:**

| Argument   | Type                           | Default     | Description                                       |
|------------|--------------------------------|-------------|---------------------------------------------------|
| `name`     | `string`                       | `slack`     | The name to save the Slack account under           |
| `save`     | `enum: "global" \| "workspace"` | `workspace` | Where to save the Slack account configuration      |

**Positionals:**

| Positional       | Required | Description                                       |
|------------------|----------|---------------------------------------------------|
| `botToken`       | No       | The Slack bot OAuth token (xoxb-...)               |
| `signingSecret`  | No       | The Slack app signing secret                       |
| `appToken`       | No       | The Slack app-level token for Socket Mode (xapp-...) |

```text
/connect slack --name=slack
```

## Tools

This package does not define any tools.

## License

MIT License — see LICENSE file for details.

---

## Developer Reference

### SlackService

Connects every configured account at startup and registers each one with `BotService` under its account name.
Disconnects and deregisters them on shutdown. Reconciliation is driven by `reconfigure`, which creates, updates, and
deletes providers against the incoming account map.

#### State properties

| Property       | Type             | Description                                                 |
|----------------|------------------|-------------------------------------------------------------|
| `name`         | `string`         | `"SlackService"`                                            |
| `description`  | `string`         | `"Connects Slack app installations to the bot service."`    |

#### SlackService methods

| Method                                            | Description                                                                                     |
|---------------------------------------------------|-------------------------------------------------------------------------------------------------|
| `getAvailableAccounts(): string[]`                | Names of the connected accounts                                                                 |
| `getProvider(name: string): SlackMessagingProvider \| undefined` | The provider for an account                                                       |
| `reconfigure(options: ResolvedSlackServiceConfig): Promise<void>` | Reconciles live providers against incoming accounts — creates, updates, or deletes each one |
| `stop(): Promise<void>`                           | Disconnects and deregisters every account from `BotService`                                    |

### SlackMessagingProvider

Implements `MessagingProvider` from `@tokenring-ai/bot` for one Slack app installation.

#### Properties

| Property             | Type     | Description                                                      |
|----------------------|----------|------------------------------------------------------------------|
| `maxMessageLength`   | `number` | `3900`, under Slack's 4000 character limit                       |
| `accountName`        | `string` | The service name this provider is registered under               |

#### SlackMessagingProvider methods

| Method                                                                 | Description                                                                                                                                    |
|------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------|
| `start(): Promise<void>`                                               | Creates the Bolt `App`, resolves the bot user id, registers event handlers, and starts the connection                                          |
| `stop(): Promise<void>`                                                | Clears all handlers and own-message tracking, then stops the Bolt `App`                                                                        |
| `onMessage(handler: IncomingMessageHandler): void`                     | Registers a handler called for every inbound message                                                                                           |
| `onMembershipChange(handler: MembershipHandler): void`                 | Registers a handler called when the app itself joins or leaves a channel                                                                       |
| `resolveConversation(targetId: string): Promise<string>`               | Opens an IM channel for user ids (`U…`/`W…`) and passes channel ids through unchanged                                                          |
| `sendMessage(conversationId: string, text: string, options?: SendOptions): Promise<string>` | Posts to a channel, and into a thread when given a `replyToMessageId`. Returns the message timestamp                                     |
| `updateMessage(conversationId: string, messageId: string, text: string): Promise<string>` | Edits a message in place, posting a fresh message if the original has gone (`message_not_found`). Returns the (possibly new) message id  |

#### Inbound message handling

Inbound messages are marked `addressed` when they are a DM, mention the bot, or reply in a thread the bot started.
Only the bot's own `<@…>` mention is stripped from the text — the others name people the agent was asked about.

`attachments` is a fetcher, not a list: nothing is downloaded until a bot claims the message. Files exceeding
`maxFileSize` are skipped, and unsupported MIME types are declined rather than throwing.

`onMembershipChange` reports `member_joined_channel` / `member_left_channel` for the app itself as `via: "invite"`,
and the first message out of a channel the app was already in as `via: "observed"` — the latter never triggers an
automatic join.

### Plugin lifecycle

| Property        | Value                              |
|-----------------|------------------------------------|
| `name`          | `@tokenring-ai/slack`              |
| `displayName`   | `Slack Integration`                |
| `version`       | `0.2.0`                            |
| `description`   | `Slack transport for TokenRing bots.` |
| `configSchema`  | `z.object({ slack: SlackServiceConfigSchema.prefault({ accounts: {} }) })` |

**`install(app)`:**

1. Adds a `SlackService` to the app.
2. Registers the `connect slack` agent command with `AgentCommandService` once that service is available.

**`reconfigure(app, config)`:**

1. Resolves secrets for every configured account — `botToken` and `signingSecret` are required (via `requireSecret`),
   `appToken` is optional (via `resolveSecret`). A misconfigured token fails here, not on first message.
2. Calls `SlackService.reconfigure({ accounts: resolvedAccounts })`, which reconciles live providers against the
   incoming accounts.

### Package Structure

```text
plugin/slack/
├── index.ts                    # Main exports
├── plugin.ts                   # Plugin definition for TokenRing integration
├── SlackService.ts             # Connects accounts, registers them with BotService
├── SlackMessagingProvider.ts   # The Slack transport
├── schema.ts                   # Configuration schemas
├── commands.ts                 # Agent command registry
├── commands/
│   └── connect/
│       └── slack.ts            # `/connect slack` command
├── integration.test.ts         # Service and transport tests
├── bun.config.ts               # Test runner configuration
├── package.json                # Package manifest
└── LICENSE                     # MIT License
```

### Dependencies

| Package                   | Description                                   |
|---------------------------|-----------------------------------------------|
| `@tokenring-ai/bot`       | Bot service and provider contract              |
| `@tokenring-ai/agent`     | Attachment types and agent command types       |
| `@tokenring-ai/app`       | Application framework                          |
| `@tokenring-ai/secrets`   | Secret resolution                              |
| `@tokenring-ai/utility`   | `KeyedRegistry` for provider management        |
| `@slack/bolt`             | Slack app framework                            |
| `zod`                     | Schema validation                              |

### Testing

```bash
bun test
```

The test suite (`integration.test.ts`) mocks the `@slack/bolt` `App` and covers account connection and registration,
inbound message normalization (mention stripping, DM detection, thread tracking), channel membership events
(invite, leave, first-sight observation), and outbound message posting and DM resolution.
