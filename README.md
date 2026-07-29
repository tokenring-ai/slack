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
- `sendMessage` posts to a channel, and into a thread when given a `replyToMessageId`
- `updateMessage` edits in place, posting a fresh message if the original has gone
- inbound messages are marked `addressed` when they are a DM, mention the bot, or reply in a thread the bot started.
  Only the bot's own `<@…>` mention is stripped from the text — the others name people the agent was asked about
- `attachments` is a fetcher, not a list: nothing is downloaded until a bot claims the message
- `onMembershipChange` reports `member_joined_channel` / `member_left_channel` for the app itself as `via: "invite"`,
  and the first message out of a channel the app was already in as `via: "observed"` — the latter never triggers an
  automatic join

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
