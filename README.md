# @tokenring-ai/slack

A Token Ring plugin providing seamless Slack integration for AI-powered conversational agents.

## Overview

This package integrates Slack with TokenRing agents, enabling natural conversations through Slack's various interaction methods. Each Slack user gets their own persistent agent instance that maintains conversation history and context.

## Features

- **Per-User Agents**: Each Slack user gets a dedicated agent with persistent chat history
- **Slash Commands**: Forward commands to agent's command system (e.g., `/help`, `/reset`)
- **@Mentions**: Respond to mentions in channels with intelligent AI responses
- **Direct Messages**: Private conversations with the bot in your DMs
- **Socket Mode**: Support for both HTTP events and Socket Mode (no public endpoint required)
- **Authorization**: Optional user whitelist for restricted access
- **Plugin Architecture**: Automatically integrates with TokenRing applications
- **Persistent State**: User agents maintain conversation context across sessions
- **Event Handling**: Comprehensive handling of chat, info, warning, and error messages
- **Timeout Management**: Configurable response timeouts for commands and messages

## Installation

```bash
bun install @tokenring-ai/slack
# or
bun add @tokenring-ai/slack
```

## Prerequisites

- Slack workspace with app creation permissions
- **Bot Token (`botToken`)**: OAuth token starting with `xoxb-`
- **Signing Secret (`signingSecret`)**: Verifies incoming Slack requests
- **App-Level Token (`appToken`)** (Optional): Token starting with `xapp-` for Socket Mode
- **Channel ID (`channelId`)** (Optional): Channel for startup announcements (e.g., `C1234567890`)
- **Authorized User IDs (`authorizedUserIds`)** (Optional): Array of user IDs allowed to use the bot
- **Default Agent Type (`defaultAgentType`)** (Optional): Agent type to create for users (defaults to "teamLeader")

## Setup

1. **Create Slack App** at [https://api.slack.com/apps](https://api.slack.com/apps)

2. **Configure OAuth & Permissions**:
   - Add Bot Token Scopes:
     - `chat:write` - Send messages
     - `app_mentions:read` - Receive @mentions
     - `im:history`, `im:read`, `im:write` - Direct messages
     - `commands` - Slash commands (optional)

3. **Install to workspace** and copy the Bot User OAuth Token

4. **Get Signing Secret** from "Basic Information" > "App Credentials"

5. **Enable Socket Mode** (optional) and generate app-level token if needed

6. **Invite bot** to channels: `/invite @YourBotName`

## Configuration

### Plugin Usage (Recommended)

When using as a TokenRing plugin, the service is automatically installed:

```typescript
import TokenRingApp from "@tokenring-ai/app";

const app = new TokenRingApp({
  // ... other config
  plugins: [
    // ... other plugins
    "@tokenring-ai/slack" // Plugin will auto-install if slack config exists
  ]
});

// Configure in your app config
app.config({
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
    appToken: process.env.SLACK_APP_TOKEN, // Optional
    channelId: process.env.SLACK_CHANNEL_ID, // Optional
    authorizedUserIds: ['U06T1LWJG', 'UABCDEF123'], // Optional
    defaultAgentType: 'teamLeader' // Optional
  }
});
```

### Manual Usage

```typescript
import TokenRingApp from "@tokenring-ai/app";
import { SlackService } from "@tokenring-ai/slack";

const app = new TokenRingApp({
  // ... app configuration
});

const slackService = new SlackService(app, {
  botToken: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  appToken: process.env.SLACK_APP_TOKEN, // Optional, enables Socket Mode
  channelId: process.env.SLACK_CHANNEL_ID, // Optional
  authorizedUserIds: ['U06T1LWJG', 'UABCDEF123'], // Optional
  defaultAgentType: 'teamLeader' // Optional
});

// Add service to the app
app.addServices(slackService);

// Start the service
await slackService.start();
```

## API Reference

### SlackService

Main service class that handles Slack integration.

#### Constructor

```typescript
new SlackService(
  app: TokenRingApp,
  config: SlackServiceConfig
)
```

#### Methods

- `start(): Promise<void>` - Start the Slack bot and begin listening for events
- `stop(): Promise<void>` - Stop the bot and clean up user agents

### SlackServiceConfig

Configuration interface for the Slack service.

```typescript
export const SlackServiceConfigSchema = z.object({
  botToken: z.string().min(1, "Bot token is required").refine(s => s.trim().length > 0, "Bot token cannot be whitespace"),
  signingSecret: z.string().min(1, "Signing secret is required").refine(s => s.trim().length > 0, "Signing secret cannot be whitespace"),
  appToken?: z.string(),
  channelId?: z.string(),
  authorizedUserIds: z.array(z.string()).default([]),
  defaultAgentType: z.string().default("teamLeader")
});

export type SlackServiceConfig = z.infer<typeof SlackServiceConfigSchema>;
```

### Exports

```typescript
export { default as SlackService } from "./SlackService.ts";
export type { SlackServiceConfig } from "./SlackService.ts";
export { SlackServiceConfigSchema } from "./SlackService.ts";
```

## Usage Examples

### Basic Interaction

- **Mention in channel**: `@BotName what is the weather today?`
- **Direct message**: Send a message directly to the bot
- **Slash command**: `/help` or `@BotName /reset`

### Advanced Configuration

```typescript
// Environment variables
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token  # Optional for Socket Mode
SLACK_CHANNEL_ID=C1234567890        # Optional for startup announcements
SLACK_AUTHORIZED_USERS=U06T1LWJG,UABCDEF123  # Optional comma-separated list
```

### Error Handling

The service automatically handles different message types:

- **Chat messages**: Direct user responses
- **Info messages**: System information with `[INFO]:` prefix
- **Warning messages**: System warnings with `[WARNING]:` prefix  
- **Error messages**: System errors with `[ERROR]:` prefix

## Event System

The Slack service handles multiple event types:

- **Slash Commands**: `/command text`
- **App Mentions**: Bot mentioned in channels
- **Direct Messages**: Private messages to the bot
- **Socket Mode**: Real-time event handling when enabled

## State Management

Each user maintains their own agent instance with:

- Persistent conversation history
- Context across sessions
- Individual configuration
- Automatic cleanup when the service stops

## Dependencies

- `@slack/bolt` ^4.6.0 - Slack app framework
- `@slack/web-api` ^7.13.0 - Slack web API client
- `@tokenring-ai/chat` ^0.2.0 - TokenRing chat functionality
- `@tokenring-ai/agent` ^0.2.0 - TokenRing agent system
- `zod` ^4.1.13 - Schema validation
- `@tokenring-ai/app` ^0.2.0 - TokenRing application framework

## Notes

- **Socket Mode**: Enabled when `appToken` is provided, otherwise uses HTTP events
- **User Agents**: Each user's agent maintains independent conversation state
- **Cleanup**: Agents are automatically cleaned up when the service stops
- **Authorization**: If `authorizedUserIds` is empty, all users can interact. Set a list to restrict access
- **Plugin System**: Designed to work seamlessly with TokenRing's plugin architecture
- **Event Handling**: The service handles slash commands, mentions, and direct messages
- **Response Formatting**: Differentiates between chat messages, info, warnings, and errors
- **Timeout Management**: Configurable timeouts prevent long-running operations

## License

MIT License - see [LICENSE](./LICENSE) file for details.