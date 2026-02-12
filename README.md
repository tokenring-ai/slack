# @tokenring-ai/slack

A TokenRing plugin providing Slack bot integration for AI-powered agent interactions through Slack.

## Overview

This package provides a Slack bot service that integrates with TokenRing agents, enabling natural language conversations through Slack. Each Slack channel gets its own dedicated agent instance that maintains conversation history and context. The service handles message routing, event processing, and automatic agent management.

## Features

- **Per-Channel Agents**: Each Slack channel gets a dedicated agent with persistent chat history
- **Event-Driven Communication**: Handles agent events and sends responses back to Slack
- **Direct Messaging with Threads**: Send messages to channels and await responses via Slack thread mechanism
- **Escalation Provider**: Implements EscalationProvider interface for agent-to-human escalation workflows
- **Authorization**: User whitelist for restricted access control per channel
- **Automatic Agent Management**: Creates and manages agents for each channel automatically
- **Error Handling**: Robust error handling with user-friendly error messages
- **Timeout Management**: Configurable agent timeout handling
- **Graceful Shutdown**: Proper cleanup of all channel agents on shutdown
- **Plugin Integration**: Seamless integration with TokenRing plugin system
- **Multiple Bots**: Support for multiple discrete Slack bots in a single service

## Installation

```bash
bun install @tokenring-ai/slack
```

## Configuration

The service uses Zod schema validation for configuration:

### Required

- **`bots`** (object): Record of bot configurations, each containing:
  - **`name`** (string): Bot display name
  - **`botToken`** (string): Slack bot token (xoxb-...)
  - **`signingSecret`** (string): Slack signing secret for request verification
  - **`channels`** (object): Record of channel configurations

### Optional

- **`appToken`** (string): App-level token for Socket Mode (xapp-...)
- **`allowedUsers`** (string[]): Array of Slack user IDs allowed to interact per channel
- **`agentType`** (string): Agent type to create for the channel

```typescript
export const SlackServiceConfigSchema = z.object({
  bots: z.record(z.string(), z.object({
    name: z.string(),
    botToken: z.string().min(1, "Bot token is required"),
    appToken: z.string().optional(),
    signingSecret: z.string().min(1, "Signing secret is required"),
    channels: z.record(z.string(), z.object({
      channelId: z.string(),
      allowedUsers: z.array(z.string()).default([]),
      agentType: z.string(),
    }))
  }))
});

export type ParsedSlackServiceConfig = z.output<typeof SlackServiceConfigSchema>;
```

## Usage

### Plugin Installation

```typescript
import TokenRingApp from '@tokenring-ai/app';
import slackPlugin from '@tokenring-ai/slack';

const app = new TokenRingApp({
  slack: {
    bots: {
      "mainBot": {
        name: "Main Bot",
        botToken: process.env.SLACK_BOT_TOKEN!,
        signingSecret: process.env.SLACK_SIGNING_SECRET!,
        appToken: process.env.SLACK_APP_TOKEN, // Optional
        channels: {
          "engineering": {
            channelId: "C1234567890",
            allowedUsers: ["U06T1LWJG", "UABCDEF123"],
            agentType: "teamLeader"
          },
          "support": {
            channelId: "C9876543210",
            allowedUsers: [],
            agentType: "supportAgent"
          }
        }
      }
    }
  }
});

app.install(slackPlugin);
await app.start();
```

### Manual Service Creation

```typescript
import TokenRingApp from '@tokenring-ai/app';
import {SlackBotService} from '@tokenring-ai/slack';
import {SlackServiceConfigSchema} from '@tokenring-ai/slack/schema';

const app = new TokenRingApp({});

const config = {
  bots: {
    "mainBot": {
      name: "Main Bot",
      botToken: process.env.SLACK_BOT_TOKEN!,
      signingSecret: process.env.SLACK_SIGNING_SECRET!,
      channels: {
        "engineering": {
          channelId: "C1234567890",
          allowedUsers: ["U06T1LWJG"],
          agentType: "teamLeader"
        }
      }
    }
  }
};

const validatedConfig = SlackServiceConfigSchema.parse(config);
const slackService = new SlackBotService(app, validatedConfig);
app.addServices(slackService);

await slackService.run(signal);
```

## Direct Messaging and Escalation

The Slack service supports direct messaging with thread-based responses, enabling synchronous communication between agents and users.

### Communication Channel API

```typescript
import {SlackBotService} from '@tokenring-ai/slack';

const slackService = agent.requireServiceByType(SlackBotService);

// Create a communication channel with a channel
const bot = slackService.getBot('mainBot');
const channel = bot.createCommunicationChannelWithChannel('engineering');

// Send a message
await channel.send('Please approve this deployment');

// Listen for a response
for await (const message of channel.receive()) {
  console.log('User responded:', message);
  break;
}
```

### How Thread Handling Works

1. Service sends message to channel via Slack
2. Message ID is stored with a reply handler
3. User replies to the message using Slack's thread feature
4. Service detects the thread reply and invokes registered listeners with the response text
5. Response is processed by the communication channel

### Escalation Provider Integration

The Slack service implements the `EscalationProvider` interface from `@tokenring-ai/escalation`:

```typescript
import escalationPlugin from '@tokenring-ai/escalation';
import slackPlugin from '@tokenring-ai/slack';

const app = new TokenRingApp({
  escalation: {
    providers: {
      slack: {
        type: 'slack',
        bot: 'mainBot',
        channel: 'engineering'
      }
    },
    groups: {
      "admins": ["engineering@slack"]
    }
  },
  slack: {
    bots: {
      "mainBot": {
        name: "Main Bot",
        botToken: process.env.SLACK_BOT_TOKEN!,
        signingSecret: process.env.SLACK_SIGNING_SECRET!,
        channels: {
          "engineering": {
            channelId: "C1234567890",
            allowedUsers: [],
            agentType: "teamLeader"
          }
        }
      }
    }
  }
});

app.install(escalationPlugin);
app.install(slackPlugin);
```

### Using Escalation in Agents

```typescript
const escalationService = agent.requireServiceByType(EscalationService);

const channel = await escalationService.initiateContactWithUserOrGroup(
  'engineering@slack',
  'Approve production deployment?',
  agent
);

for await (const message of channel.receive()) {
  if (message.toLowerCase().includes('yes')) {
    console.log('Deployment approved');
  }
  await channel.close();
  break;
}
```

## API Reference

### Exports

- **`default`** - Plugin object for TokenRingApp installation
- **`SlackBotService`** - The main service class
- **`SlackEscalationProvider`** - Escalation provider implementation
- **`SlackServiceConfigSchema`** - Zod schema for configuration validation (in `@tokenring-ai/slack/schema`)

### SlackBotService Class

#### Constructor

```typescript
constructor(app: TokenRingApp, config: ParsedSlackServiceConfig)
```

#### Methods

- **`run(signal: AbortSignal): Promise<void>`**: Starts all configured Slack bots and begins listening for messages
- **`getBot(botName: string): SlackBot | undefined`**: Gets a bot instance by name
- **`getAvailableBots(): string[]`**: Returns list of configured bot names

### SlackBot Class

#### Methods

- **`createCommunicationChannelWithChannel(channelName: string)`**: Creates a communication channel for a configured channel
- **`createCommunicationChannelWithUser(userId: string)`**: Creates a communication channel for a specific user/channel ID
- **`getBotUserId(): string | undefined`**: Returns the bot's user ID

## Getting Started

### 1. Create a Slack App

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps)
2. Click "Create New App" → "From scratch"
3. Name your app and select your workspace

### 2. Configure Bot Permissions

Add these OAuth scopes under "OAuth & Permissions":
- `chat:write` - Send messages
- `app_mentions:read` - Receive @mentions
- `channels:history` - Read channel messages
- `channels:read` - View channel info

### 3. Enable Socket Mode (Optional)

1. Go to "Socket Mode" in your app settings
2. Enable Socket Mode
3. Generate an app-level token with `connections:write` scope

### 4. Install App to Workspace

1. Go to "Install App"
2. Click "Install to Workspace"
3. Copy the "Bot User OAuth Token" (starts with `xoxb-`)

### 5. Get Signing Secret

1. Go to "Basic Information"
2. Copy the "Signing Secret"

### 6. Invite Bot to Channels

In each channel: `/invite @YourBotName`

### 7. Set Up Environment Variables

```bash
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token  # Optional for Socket Mode
```

## Event Handling

The service handles the following agent events:

- **`output.chat`**: Processes chat content and sends accumulated responses to Slack
- **`output.info`**: Formats system messages with level indicators (INFO)
- **`output.warning`**: Formats system messages with level indicators (WARNING)
- **`output.error`**: Formats system messages with level indicators (ERROR)
- **`input.handled`**: Handles input completion, cleans up subscriptions, and manages timeouts

## Error Handling

### Bot-Level Errors

- **Connection Errors**: Logged to console with error details
- **Message Processing**: Wrapped in try-catch to prevent crashes
- **Bot Startup**: Validates configuration before initialization

### User-Level Errors

- **Authorization**: Sends "Sorry, you are not authorized." for unauthorized users
- **Timeout**: Sends "Agent timed out after {time} seconds." when agents exceed max runtime
- **No Response**: Sends "No response received from agent." when no output is generated

### Service-Level Errors

- **Configuration**: Validates bot tokens and signing secrets on construction
- **Shutdown**: Graceful cleanup with error handling for bot stop operations
- **Resource Management**: Proper cleanup of all channel agents on service termination

## Security Considerations

- **Bot Token Security**: Never commit bot tokens to version control
- **User Authorization**: Use `allowedUsers` to restrict bot access per channel
- **Input Validation**: All user input is validated and sanitized
- **Error Information**: Error messages are user-friendly without exposing internal details
- **Resource Cleanup**: Proper cleanup prevents resource leaks

## License

MIT License - see [LICENSE](./LICENSE) file for details.
