# @tokenring-ai/slack

A TokenRing plugin providing Slack bot integration for AI-powered agent interactions through Slack.

## Overview

This package provides a Slack bot service that integrates with TokenRing agents, enabling natural language conversations through Slack. Each Slack channel gets its own dedicated agent instance that maintains conversation history and context. The service handles message routing, event processing, and automatic agent management. It also supports escalation workflows for agent-to-human communication.

The package uses the `@slack/bolt` framework for event handling and supports both traditional RTM mode and Socket Mode for firewall-friendly connections.

## Features

- **Multiple Bot Support**: Manage multiple discrete Slack bots in a single service
- **Per-Channel Agents**: Each Slack channel gets a dedicated agent with persistent chat history
- **Event-Driven Communication**: Handles agent events and sends responses back to Slack
- **Thread-Based Messaging**: Send messages and await synchronous responses via Slack threads
- **Message Buffering**: Automatic message chunking for long responses (3900 char limit) with throttling (250ms delay)
- **Escalation Provider**: Implements `EscalationProvider` interface for agent-to-human escalation workflows
- **Authorization**: User whitelist for restricted access control per channel
- **Automatic Agent Management**: Creates and manages agents for each channel automatically
- **Graceful Shutdown**: Proper cleanup of all channel agents on shutdown with message flushing
- **Socket Mode Support**: Optional Socket Mode for firewall-friendly connections
- **Error Handling**: Robust error handling with user-friendly error messages
- **Timeout Management**: Configurable agent timeout handling via `maxRunTime`
- **Plugin Integration**: Seamless integration with TokenRing plugin system with automatic escalation provider registration
- **Service Logging**: Uses `serviceOutput` and `serviceError` for consistent logging

## Installation

```bash
bun install @tokenring-ai/slack
```

## Configuration

The package uses Zod schema validation for configuration with a nested structure for multiple bots.

### Required Configuration

- **`bots`** (object): Record of bot configurations, where each key is a bot name
- Each bot configuration contains:
  - **`name`** (string): Bot display name
  - **`botToken`** (string): Slack bot token (xoxb-...)
  - **`signingSecret`** (string): Slack signing secret for request verification
  - **`channels`** (object): Record of channel configurations for this bot
  - Each channel configuration contains:
    - **`channelId`** (string): Slack channel ID
    - **`allowedUsers`** (string[]): Array of Slack user IDs allowed to interact (defaults to empty array for all users)
    - **`agentType`** (string): Agent type to create for the channel

### Optional Configuration

- **`appToken`** (string): App-level token for Socket Mode (xapp-...)

```typescript
import {z} from "zod";

// Bot configuration schema
export const SlackBotConfigSchema = z.object({
  name: z.string(),
  botToken: z.string().min(1, "Bot token is required"),
  appToken: z.string().optional(),
  signingSecret: z.string().min(1, "Signing secret is required"),
  channels: z.record(z.string(), z.object({
    channelId: z.string(),
    allowedUsers: z.array(z.string()).default([]),
    agentType: z.string(),
  }))
});

export type ParsedSlackBotConfig = z.output<typeof SlackBotConfigSchema>;

// Service configuration schema
export const SlackServiceConfigSchema = z.object({
  bots: z.record(z.string(), SlackBotConfigSchema)
});

export type ParsedSlackServiceConfig = z.output<typeof SlackServiceConfigSchema>;
```

### Escalation Provider Configuration

The escalation provider uses a simple configuration schema:

```typescript
import {z} from "zod";

export const SlackEscalationProviderConfigSchema = z.object({
  type: z.literal('slack'),
  bot: z.string(),
  channel: z.string(),
});

export type ParsedSlackEscalationProviderConfig = z.output<typeof SlackEscalationProviderConfigSchema>;
```

## Usage

### Plugin Installation

Install the plugin with your TokenRing application:

```typescript
import TokenRingApp from '@tokenring-ai/app';
import slackPlugin from '@tokenring-ai/slack';
import escalationPlugin from '@tokenring-ai/escalation';

const app = new TokenRingApp({
  slack: {
    bots: {
      "mainBot": {
        name: "Main Bot",
        botToken: process.env.SLACK_BOT_TOKEN!,
        signingSecret: process.env.SLACK_SIGNING_SECRET!,
        appToken: process.env.SLACK_APP_TOKEN, // Optional for Socket Mode
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
  },
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
  }
});

app.install(slackPlugin);
app.install(escalationPlugin);
await app.start();
```

**Note**: When both `slackPlugin` and `escalationPlugin` are installed and escalation configuration is present, the plugin automatically registers `SlackEscalationProvider` instances for each provider with `type: 'slack'`.

### Manual Service Creation

Create the Slack service manually if you prefer more control:

```typescript
import TokenRingApp from '@tokenring-ai/app';
import SlackService from '@tokenring-ai/slack/SlackService';
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
const slackService = new SlackService(app, validatedConfig);
app.addServices(slackService);

await slackService.run(signal);
```

### Escalation Provider Usage

Use the escalation provider to create communication channels with users or groups:

```typescript
import {SlackEscalationProvider} from '@tokenring-ai/slack';
import {SlackEscalationProviderConfigSchema} from '@tokenring-ai/slack/schema';
import {EscalationService} from '@tokenring-ai/escalation';

// Programmatic registration
const escalationService = agent.requireServiceByType(EscalationService);
escalationService.registerProvider('slackProvider', new SlackEscalationProvider(
  SlackEscalationProviderConfigSchema.parse({
    type: 'slack',
    bot: 'mainBot',
    channel: 'engineering'
  })
));

// Use the escalation channel
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

## Direct Messaging and Escalation

The Slack service supports direct messaging with thread-based responses, enabling synchronous communication between agents and users.

### Communication Channel API

```typescript
import SlackService from '@tokenring-ai/slack';

const slackService = agent.requireServiceByType(SlackService);

// Get a bot instance
const bot = slackService.getBot('mainBot');

// Create a communication channel with a channel
const channel = bot.createCommunicationChannelWithChannel('engineering');

// Send a message
await channel.send('Please approve this deployment');

// Listen for a response
for await (const message of channel.receive()) {
  console.log('User responded:', message);
  break;
}

// Close the channel when done
await channel[Symbol.asyncDispose]();
```

### How Thread Handling Works

1. Service sends message to channel via Slack
2. Message ID is stored with a reply handler
3. User replies to the message using Slack's thread feature
4. Service detects the thread reply and invokes registered listeners with the response text
5. Response is processed by the communication channel

### Escalation Provider Integration

When using the plugin, the escalation provider is automatically registered if both plugins are installed and escalation configuration is present:

```typescript
const app = new TokenRingApp({
  slack: { /* bot configuration */ },
  escalation: {
    providers: {
      slack: { type: 'slack', bot: 'mainBot', channel: 'engineering' }
    }
  }
});

app.install(slackPlugin);  // Registers bots and automatically registers escalation provider
app.install(escalationPlugin);  // Enables escalation service
```

## Message Buffering and Throttling

The Slack bot implements message buffering and throttling to handle long responses and respect Slack's API limits:

- **Maximum Message Length**: 3900 characters (Slack's limit)
- **Throttle Delay**: 250ms between message sends
- **Message Chunking**: Long messages are automatically split into chunks
- **Message Update**: Subsequent chunks update the original message when possible
- **Buffer Flushing**: All pending messages are flushed before shutdown

### Example: Long Response Handling

```typescript
// When an agent produces a long response, it's automatically chunked:
// 1. First chunk is posted as a new message
// 2. Subsequent chunks update the same message
// 3. If update fails (message not found), a new message is posted
```

## API Reference

### Exports

- **`default`** - Plugin object for TokenRingApp installation
- **`SlackService`** - The main service class (also exported as `SlackBotService` for backwards compatibility)
- **`SlackEscalationProvider`** - Escalation provider implementation
- **`SlackServiceConfigSchema`** - Zod schema for configuration validation (in `@tokenring-ai/slack/schema`)
- **`SlackBotConfigSchema`** - Zod schema for bot configuration (in `@tokenring-ai/slack/schema`)
- **`SlackEscalationProviderConfigSchema`** - Zod schema for escalation provider (in `@tokenring-ai/slack/schema`)

### SlackService Class

#### Constructor

```typescript
constructor(app: TokenRingApp, options: ParsedSlackServiceConfig)
```

#### Properties

- **`name`**: `"SlackService"` - Service name identifier
- **`description`**: `"Manages multiple Slack bots for interacting with TokenRing agents."` - Service description

#### Methods

- **`run(signal: AbortSignal): Promise<void>`**: Starts all configured Slack bots and begins listening for messages. Handles graceful shutdown when the signal is aborted.
- **`getBot(botName: string): SlackBot | undefined`**: Gets a bot instance by name
- **`getAvailableBots(): string[]`**: Returns list of configured bot names

### SlackBot Class

#### Constructor

```typescript
constructor(
  tokenRingApp: TokenRingApp,
  slackService: SlackService,
  botName: string,
  config: ParsedSlackBotConfig
)
```

#### Methods

- **`start(): Promise<void>`**: Starts the Slack bot, registers event handlers, and announces to configured channels
- **`stop(): Promise<void>`**: Stops the Slack bot, flushes pending messages, and deletes all channel agents
- **`createCommunicationChannelWithChannel(channelName: string): CommunicationChannel`**: Creates a communication channel for a configured channel
- **`createCommunicationChannelWithUser(userId: string): CommunicationChannel`**: Creates a communication channel for a specific user/channel ID
- **`getBotUserId(): string | undefined`**: Returns the bot's user ID

### SlackEscalationProvider Class

#### Constructor

```typescript
constructor(config: ParsedSlackEscalationProviderConfig)
```

#### Methods

- **`createCommunicationChannelWithUser(channelName: string, agent: Agent): Promise<CommunicationChannel>`**: Creates a communication channel for escalation workflows

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
- `groups:history` - Read private channel messages (for private channels)
- `groups:read` - View private channel info (for private channels)
- `im:history` - Read direct messages
- `mpim:history` - Read group direct messages

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

- **`output.chat`**: Processes chat content and sends accumulated responses to Slack via message buffering
- **`output.info`**: Formats system messages with level indicators `[INFO]`
- **`output.warning`**: Formats system messages with level indicators `[WARNING]`
- **`output.error`**: Formats system messages with level indicators `[ERROR]`
- **`input.handled`**: Handles input completion, cleans up subscriptions, manages timeouts, and flushes pending messages

## Slack Bot Event Handlers

The Slack bot registers the following event handlers:

- **`message()`**: Handles all message events, including direct messages and channel messages
- **`event('app_mention')`**: Handles @mention events in channels

Both handlers:
- Filter out bot messages
- Validate user authorization
- Route messages to the appropriate channel agent
- Handle thread replies for synchronous communication

## Error Handling

### Bot-Level Errors

- **Connection Errors**: Logged via `serviceError` with error details
- **Message Processing**: Wrapped in try-catch to prevent crashes, errors logged via `serviceError`
- **Bot Startup**: Validates configuration before initialization

### User-Level Errors

- **Authorization**: Sends "Sorry, you are not authorized." for unauthorized users
- **Timeout**: Agent timeout is handled via `maxRunTime` configuration, aborts agent execution
- **No Response**: Sends "No response received from agent." when no output is generated

### Service-Level Errors

- **Configuration**: Validates bot tokens and signing secrets via Zod schema on construction
- **Shutdown**: Graceful cleanup with error handling for bot stop operations, all pending messages are flushed
- **Resource Management**: Proper cleanup of all channel agents on service termination via `AgentManager.deleteAgent`

## Agent Lifecycle Management

The Slack bot automatically manages agent lifecycle:

1. **Agent Creation**: When a message is received in a channel, an agent is created if one doesn't exist
2. **Agent Reuse**: Existing agents are reused for subsequent messages in the same channel
3. **Agent Deletion**: When the bot stops, all channel agents are deleted via `AgentManager.deleteAgent` with reason "Slack bot was shut down."

## Security Considerations

- **Bot Token Security**: Never commit bot tokens to version control
- **User Authorization**: Use `allowedUsers` to restrict bot access per channel
- **Input Validation**: All user input is validated and sanitized
- **Error Information**: Error messages are user-friendly without exposing internal details
- **Resource Cleanup**: Proper cleanup prevents resource leaks
- **Thread Safety**: Message IDs are tracked to ensure thread replies are routed correctly

## Testing

The package includes comprehensive unit and integration tests:

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Run tests with coverage
bun test --coverage
```

## Dependencies

### Production Dependencies

- `@tokenring-ai/app` (0.2.0) - TokenRing application framework
- `@tokenring-ai/chat` (0.2.0) - Chat service integration
- `@tokenring-ai/agent` (0.2.0) - Agent system
- `@tokenring-ai/utility` (0.2.0) - Shared utilities
- `@tokenring-ai/escalation` (0.2.0) - Escalation service
- `@slack/bolt` (^4.6.0) - Slack Bolt framework
- `@slack/web-api` (^7.14.1) - Slack Web API
- `zod` (^4.3.6) - Schema validation

### Development Dependencies

- `vitest` (^4.0.18) - Testing framework
- `typescript` (^5.9.3) - TypeScript compiler

## License

MIT License - see LICENSE file for details.
