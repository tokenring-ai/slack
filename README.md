# @tokenring-ai/slack

A TokenRing plugin providing Slack bot integration for AI-powered agent interactions through Slack.

## Overview

This package provides a Slack bot service that integrates with TokenRing agents, enabling natural language conversations through Slack. Each Slack channel gets its own dedicated agent instance that maintains conversation history and context. The service handles message routing, event processing, and automatic agent management. It also supports escalation workflows for agent-to-human communication.

The package uses the `@slack/bolt` framework for event handling and supports Socket Mode for firewall-friendly connections.

## Features

- **Multiple Bot Support**: Manage multiple discrete Slack bots in a single service
- **Per-Channel Agents**: Each Slack channel gets a dedicated agent with persistent chat history
- **Event-Driven Communication**: Handles agent events and sends responses back to Slack
- **Thread-Based Messaging**: Send messages and await synchronous responses via Slack threads
- **Message Buffering**: Automatic message chunking for long responses (3900 char limit) with throttling (250ms delay)
- **Escalation Provider**: Implements `EscalationProvider` interface for agent-to-human escalation workflows
- **Authorization**: User whitelist for restricted access control per channel and DMs
- **Automatic Agent Management**: Creates and manages agents for each channel automatically
- **Graceful Shutdown**: Proper cleanup of all channel agents on shutdown with message flushing
- **Socket Mode Support**: Optional Socket Mode for firewall-friendly connections
- **Direct Messaging**: Support for direct messages with authorized users
- **File Attachments**: Download and process Slack file attachments (up to 20MB by default)
- **Error Handling**: Robust error handling with user-friendly error messages
- **Plugin Integration**: Seamless integration with TokenRing plugin system with automatic escalation provider registration
- **Service Logging**: Uses `serviceOutput` and `serviceError` for consistent logging

## Installation

```bash
bun add @tokenring-ai/slack
```

## Core Components/API

### Exports

- **`SlackBotService`** (default export alias from `./SlackService`) - The main service class
- **`SlackEscalationProvider`** (from `./SlackEscalationProvider`) - Escalation provider implementation
- **`SlackServiceConfigSchema`** (from `./schema`) - Zod schema for service configuration validation
- **`SlackBotConfigSchema`** (from `./schema`) - Zod schema for bot configuration
- **`SlackEscalationProviderConfigSchema`** (from `./schema`) - Zod schema for escalation provider configuration

### SlackService Class

The main service class that manages multiple Slack bots.

**Note**: The class is exported as `SlackBotService` in `index.ts` for backward compatibility, but the actual class name is `SlackService`.

#### Properties

- **`name`**: `"SlackService"` - Service name identifier
- **`description`**: `"Manages multiple Slack bots for interacting with TokenRing agents."` - Service description

#### Constructor

- **`constructor(app: TokenRingApp, options: ParsedSlackServiceConfig)`**: Creates a new Slack service instance

#### Methods

- **`run(signal: AbortSignal): Promise<void>`**: Starts all configured Slack bots and begins listening for messages. Handles graceful shutdown when the signal is aborted.
- **`getBot(botName: string): SlackBot | undefined`**: Gets a bot instance by name
- **`getAvailableBots(): string[]`**: Returns list of configured bot names

### SlackBot Class

Manages a single Slack bot instance and handles message processing.

#### Methods

- **`constructor(tokenRingApp: TokenRingApp, slackService: SlackService, botName: string, config: ParsedSlackBotConfig)`**: Creates a new Slack bot instance
- **`start(): Promise<void>`**: Starts the Slack bot, registers event handlers, and announces to configured channels
- **`stop(): Promise<void>`**: Stops the Slack bot, flushes pending messages, and deletes all channel agents
- **`createCommunicationChannelWithChannel(channelName: string): CommunicationChannel`**: Creates a communication channel for a configured channel
- **`createCommunicationChannelWithUser(userId: string): CommunicationChannel`**: Creates a communication channel for a specific user/channel ID
- **`getBotUserId(): string | undefined`**: Returns the bot's user ID

### SlackEscalationProvider Class

Implements the `EscalationProvider` interface for escalation workflows.

#### Methods

- **`constructor(config: ParsedSlackEscalationProviderConfig)`**: Creates a new escalation provider instance
- **`createCommunicationChannelWithUser(channelName: string, agent: Agent): Promise<CommunicationChannel>`**: Creates a communication channel for escalation workflows

### splitIntoChunks Function

Splits text into chunks suitable for Slack messages.

```typescript
function splitIntoChunks(text: string | null): string[]
```

- **Parameters**:
  - `text`: The text to split, or null for a "working" message
- **Returns**: Array of message chunks (max 3900 characters each)

## Usage Examples

### Plugin Installation

Install the plugin with your TokenRing application:

```typescript
import TokenRingApp from '@tokenring-ai/app';
import slackPlugin from '@tokenring-ai/slack';
import escalationPlugin from '@tokenring-ai/escalation';

// Configure the app with Slack and Escalation settings
const app = new TokenRingApp({
  slack: {
    bots: {
      "mainBot": {
        name: "Main Bot",
        botToken: process.env.SLACK_BOT_TOKEN!,
        signingSecret: process.env.SLACK_SIGNING_SECRET!,
        appToken: process.env.SLACK_APP_TOKEN, // Optional for Socket Mode
        joinMessage: "Hello! I'm the AI assistant bot.", // Optional welcome message
        maxFileSize: 20_971_520, // 20MB default
        channels: {
          "engineering": {
            channelId: "C1234567890",
            allowedUsers: ["U06T1LWJG", "UABCDEF123"], // Empty array allows all users
            agentType: "teamLeader"
          },
          "support": {
            channelId: "C9876543210",
            allowedUsers: [],
            agentType: "supportAgent"
          }
        },
        dmAgentType: "dmAgent", // Optional: Enable DMs with this agent type
        dmAllowedUsers: ["U06T1LWJG"] // Optional: Restrict DMs to specific users
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

// Install plugins - order matters for escalation provider registration
app.install(slackPlugin);
app.install(escalationPlugin);
await app.start();
```

**Note**: When both `slackPlugin` and `escalationPlugin` are installed and escalation configuration is present, the plugin automatically registers `SlackEscalationProvider` instances for each provider with `type: 'slack'` to the `EscalationService`.

### Manual Service Creation

Create the Slack service manually if you prefer more control:

```typescript
import TokenRingApp from '@tokenring-ai/app';
import SlackService from '@tokenring-ai/slack/SlackService';
import {SlackServiceConfigSchema} from '@tokenring-ai/slack/schema';

const app = new TokenRingApp({});

// Define and validate configuration
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

// Start the service with an abort signal
await slackService.run(signal);
```

### Escalation Provider Usage

Use the escalation provider to create communication channels with users or groups:

```typescript
import {SlackEscalationProvider} from '@tokenring-ai/slack';
import {SlackEscalationProviderConfigSchema} from '@tokenring-ai/slack/schema';
import {EscalationService} from '@tokenring-ai/escalation';

// Programmatic registration (alternative to plugin-based registration)
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

// Listen for responses
for await (const message of channel.receive()) {
  if (message.toLowerCase().includes('yes')) {
    console.log('Deployment approved');
  }
  await channel.close();
  break;
}
```

### Direct Communication Channel Usage

Create communication channels for synchronous interactions:

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

## Configuration

The package uses Zod schema validation for configuration with a nested structure for multiple bots. Schemas are exported from `./schema`.

### SlackBotConfigSchema

```typescript
import {z} from "zod";

export const SlackBotConfigSchema = z.object({
  name: z.string(),
  botToken: z.string().min(1, "Bot token is required"),
  appToken: z.string().optional(),
  signingSecret: z.string().min(1, "Signing secret is required"),
  joinMessage: z.string().optional(),
  maxFileSize: z.number().default(20_971_520), // 20MB default
  channels: z.record(z.string(), z.object({
    channelId: z.string(),
    allowedUsers: z.array(z.string()).default([]),
    agentType: z.string(),
  })),
  dmAgentType: z.string().optional(),
  dmAllowedUsers: z.array(z.string()).default([]),
});

export type ParsedSlackBotConfig = z.output<typeof SlackBotConfigSchema>;
```

**Note**: The `channels` record can be empty, but each channel entry requires `channelId` and `agentType`.

**Bot Configuration Options:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | Yes | Bot display name |
| `botToken` | string | Yes | Slack bot token (xoxb-...) |
| `signingSecret` | string | Yes | Slack signing secret for request verification |
| `appToken` | string | No | App-level token for Socket Mode (xapp-...) |
| `joinMessage` | string | No | Message to post when bot joins channels |
| `maxFileSize` | number | No | Maximum file size for attachments (default: 20MB) |
| `channels` | object | Yes | Record of channel configurations |
| `dmAgentType` | string | No | Agent type for direct messages (enables DMs if set) |
| `dmAllowedUsers` | string[] | No | Array of user IDs allowed to DM the bot |

### SlackServiceConfigSchema

```typescript
import {z} from "zod";

export const SlackServiceConfigSchema = z.object({
  bots: z.record(z.string(), SlackBotConfigSchema)
});

export type ParsedSlackServiceConfig = z.output<typeof SlackServiceConfigSchema>;
```

### Channel Configuration

Each channel in the `channels` record has the following structure:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `channelId` | string | Yes | Slack channel ID |
| `allowedUsers` | string[] | No | Array of Slack user IDs allowed to interact (empty = all users) |
| `agentType` | string | Yes | Agent type to create for the channel |

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

**Escalation Provider Options:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `type` | 'slack' | Yes | Must be the literal 'slack' |
| `bot` | string | Yes | Name of the bot to use |
| `channel` | string | Yes | Name of the channel configuration to use |

## Integration

### Plugin Registration

The plugin automatically registers services and escalation providers when installed with configuration:

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
        channels: {
          "engineering": {
            channelId: "C1234567890",
            agentType: "teamLeader"
          }
        }
      }
    }
  }
});

app.install(slackPlugin);
await app.start();
```

### Service Registration

Services are automatically registered when the plugin is installed with configuration:

1. `SlackService` is registered with the application via `app.addServices()`
2. If escalation configuration is present and `escalationPlugin` is also installed, `SlackEscalationProvider` instances are automatically registered with the `EscalationService`

### Escalation Service Integration

The escalation provider integrates with the `EscalationService`:

```typescript
import {EscalationService} from '@tokenring-ai/escalation';

const escalationService = app.requireServiceByType(EscalationService);

// The provider is automatically registered if both slackPlugin and escalationPlugin are installed
// with appropriate escalation configuration
const channel = await escalationService.initiateContactWithUserOrGroup(
  'group-name',
  'Message for escalation',
  agent
);
```

### Manual Escalation Provider Registration

If you prefer manual registration, you can register the escalation provider directly:

```typescript
import {EscalationService} from '@tokenring-ai/escalation';
import {SlackEscalationProvider} from '@tokenring-ai/slack';
import {SlackEscalationProviderConfigSchema} from '@tokenring-ai/slack/schema';

const escalationService = app.requireServiceByType(EscalationService);
escalationService.registerProvider('slackProvider', new SlackEscalationProvider(
  SlackEscalationProviderConfigSchema.parse({
    type: 'slack',
    bot: 'mainBot',
    channel: 'engineering'
  })
));
```

## RPC Endpoints

This package does not define RPC endpoints. Communication is handled through Slack's API via the `@slack/bolt` framework.

## State Management

This package does not maintain persistent state. All state is managed in-memory and is cleared on shutdown:

- Channel agents are deleted via `AgentManager.deleteAgent` on shutdown
- Message buffers are flushed before shutdown
- All pending requests are cleaned up

## Chat Commands

This package does not define chat commands. Commands are handled by the agent system and processed through Slack messages.

## Best Practices

### Security

- **Bot Token Security**: Never commit bot tokens to version control. Use environment variables.
- **User Authorization**: Use `allowedUsers` to restrict bot access per channel.
- **DM Authorization**: Use `dmAllowedUsers` to restrict direct message access.
- **File Size Limits**: Configure `maxFileSize` appropriately for your use case.

### Performance

- **Socket Mode**: Use Socket Mode for firewall-friendly connections and better reliability.
- **Message Throttling**: The built-in 250ms throttle prevents API rate limiting.
- **Agent Reuse**: Agents are reused per channel to maintain conversation context.
- **Graceful Shutdown**: Always use proper shutdown signals to ensure message flushing.

### Error Handling

- **Authorization Errors**: Unauthorized users receive friendly error messages.
- **File Download Errors**: Failed file downloads are logged but don't block message processing.
- **Message Send Errors**: Failed messages are retried with fallback to new message creation.
- **Agent Errors**: Agent errors are logged via `serviceError` without crashing the bot.

## Testing and Development

The package includes comprehensive integration tests using vitest:

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Run tests with coverage
bun test --coverage

# Type check
bun run build
```

### Package Structure

```
pkg/slack/
├── index.ts                    # Main exports (SlackBotService, SlackEscalationProvider)
├── plugin.ts                   # TokenRing plugin definition with auto-registration
├── schema.ts                   # Zod configuration schemas for service, bot, and escalation provider
├── SlackService.ts             # Main service class managing multiple Slack bots
├── SlackBot.ts                 # Bot implementation with message handling and agent management
├── SlackEscalationProvider.ts  # Escalation provider implementation
├── splitIntoChunks.ts          # Message chunking utility for Slack's 3900 char limit
├── integration.test.ts         # Integration tests with mocked Slack Bolt
├── vitest.config.ts           # Test configuration
└── package.json               # Package metadata and dependencies
```

## Dependencies

### Production Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@tokenring-ai/app` | 0.2.0 | TokenRing application framework |
| `@tokenring-ai/chat` | 0.2.0 | Chat functionality |
| `@tokenring-ai/agent` | 0.2.0 | Agent system |
| `@tokenring-ai/utility` | 0.2.0 | Shared utilities |
| `@tokenring-ai/escalation` | 0.2.0 | Escalation service |
| `@slack/bolt` | ^4.6.0 | Slack Bolt framework |
| `@slack/web-api` | ^7.15.0 | Slack Web API |
| `axios` | ^1.13.6 | HTTP client for file downloads |
| `zod` | ^4.3.6 | Schema validation |

### Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `vitest` | ^4.1.1 | Testing framework |
| `typescript` | ^6.0.2 | TypeScript compiler |

## Related Components

- **@tokenring-ai/escalation**: Escalation service for agent-to-human communication
- **@tokenring-ai/agent**: Agent system for AI-powered interactions
- **@tokenring-ai/app**: TokenRing application framework

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

### Agent Events

The service handles the following agent events:

- **`output.chat`**: Processes chat content and sends accumulated responses to Slack via message buffering
- **`output.info`**: Formats system messages with level indicators `[INFO]`
- **`output.warning`**: Formats system messages with level indicators `[WARNING]`
- **`output.error`**: Formats system messages with level indicators `[ERROR]`
- **`input.handled`**: Handles input completion, cleans up subscriptions, manages timeouts, and flushes pending messages

### Slack Bot Event Handlers

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
- **No Response**: Sends "No response received from agent." when no output is generated

### Service-Level Errors

- **Configuration**: Validates bot tokens and signing secrets via Zod schema on construction
- **Shutdown**: Graceful cleanup with error handling for bot stop operations, all pending messages are flushed
- **Resource Management**: Proper cleanup of all channel agents on service termination via `AgentManager.deleteAgent`

## Message Buffering and Throttling

The Slack bot implements message buffering and throttling to handle long responses and respect Slack's API limits:

- **Maximum Message Length**: 3900 characters (Slack's limit)
- **Throttle Delay**: 250ms between message sends
- **Message Chunking**: Long messages are automatically split into chunks
- **Message Update**: Subsequent chunks update the original message when possible
- **Buffer Flushing**: All pending messages are flushed before shutdown

### How Message Buffering Works

1. Agent output is accumulated in a response buffer
2. When the buffer is ready to send, it's split into chunks (max 3900 chars)
3. First chunk is posted as a new message
4. Subsequent chunks update the same message when possible
5. If update fails (message not found), a new message is posted
6. All pending messages are flushed before shutdown

## Agent Lifecycle Management

The Slack bot automatically manages agent lifecycle:

1. **Agent Creation**: When a message is received in a channel, an agent is created if one doesn't exist
2. **Agent Reuse**: Existing agents are reused for subsequent messages in the same channel
3. **Agent Deletion**: When the bot stops, all channel agents are deleted via `AgentManager.deleteAgent` with reason "Slack bot was shut down."

## License

MIT License - see LICENSE file for details.
