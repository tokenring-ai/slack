# @tokenring-ai/slack

## Overview

A Token Ring plugin providing seamless Slack integration for AI-powered conversational agents. This package enables natural conversations through Slack's various interaction methods, with each Slack user getting their own persistent agent instance that maintains conversation history and context across sessions.

## Key Features

- **Per-User Agents**: Each Slack user gets a dedicated agent with persistent chat history
- **Slash Commands**: Forward commands to agent's command system (e.g., `/help`, `/reset`)
- **@Mentions**: Respond to mentions in channels with intelligent AI responses
- **Direct Messages**: Private conversations with the bot in your DMs
- **Socket Mode Support**: Handles both HTTP events and Socket Mode (no public endpoint required)
- **Authorization**: Optional user whitelist for restricted access
- **Persistent State**: User agents maintain conversation context across sessions
- **Event Handling**: Comprehensive handling of chat, info, warning, and error messages
- **Timeout Management**: Configurable response timeouts for commands and messages
- **Type-Safe Configuration**: Zod schema validation for all configuration options

## Installation

```bash
bun install @tokenring-ai/slack
```

## Chat Commands

This package does not have a chatCommands.ts file or commands/ directory. Slack interactions are handled through mentions, direct messages, and slash commands.

## Plugin Configuration

Configure the plugin through your TokenRingApp configuration:

```typescript
import TokenRingApp from "@tokenring-ai/app";

const app = new TokenRingApp({
  // ... other config
  plugins: [
    // ... other plugins
    "@tokenring-ai/slack"
  ]
});

// Configure in your app config
app.config({
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
    appToken: process.env.SLACK_APP_TOKEN, // Optional: enables Socket Mode
    channelId: process.env.SLACK_CHANNEL_ID, // Optional
    authorizedUserIds: ['U06T1LWJG', 'UABCDEF123'], // Optional
    defaultAgentType: 'teamLeader' // Optional: defaults to "teamLeader"
  }
});
```

### Configuration Schema

The SlackService uses Zod for configuration validation:

```typescript
export const SlackServiceConfigSchema = z.object({
  botToken: z.string().min(1, "Bot token is required").refine(s => s.trim().length > 0, "Bot token cannot be whitespace"),
  signingSecret: z.string().min(1, "Signing secret is required").refine(s => s.trim().length > 0, "Signing secret cannot be whitespace"),
  appToken: z.string().optional(),
  channelId: z.string().optional(),
  authorizedUserIds: z.array(z.string()).default([]),
  defaultAgentType: z.string().default("teamLeader")
});

export type SlackServiceConfig = z.infer<typeof SlackServiceConfigSchema>;
```

### Configuration Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `botToken` | string | Yes | OAuth token starting with `xoxb-` |
| `signingSecret` | string | Yes | Verifies incoming Slack requests |
| `appToken` | string | No | Token starting with `xapp-` for Socket Mode |
| `channelId` | string | No | Channel for startup announcements (e.g., `C1234567890`) |
| `authorizedUserIds` | string[] | No | Array of user IDs allowed to use the bot |
| `defaultAgentType` | string | No | Agent type to create for users (defaults to "teamLeader") |

## Tools

This package does not have a tools.ts file or tools/ directory.

## Services

### SlackService

Main service class that handles Slack integration.

#### Constructor

```typescript
constructor(app: TokenRingApp, config: SlackServiceConfig)
```

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Always `"SlackService"` |
| `description` | string | Description of the service |
| `app` | TokenRingApp | Reference to the parent application |
| `config` | SlackServiceConfig | Configuration for the service |

#### Methods

##### run(signal: AbortSignal): Promise<void>

Starts the Slack bot and begins listening for events. Handles cleanup on abort signal.

```typescript
const abortController = new AbortController();
await slackService.run(abortController.signal);
```

## Providers

This package does not have provider definitions.

## RPC Endpoints

This package does not define RPC endpoints.

## State Management

This package does not implement state management.

## Usage Examples

### Basic Slack Interaction

- **Mention in channel**: `@BotName what is the weather today?`
- **Direct message**: Send a message directly to the bot
- **Slash command**: `/help` or `@BotName /reset`

### Manual Service Usage

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

// Start the service with AbortSignal
const abortController = new AbortController();
await slackService.run(abortController.signal);
```

### Environment Variables

```bash
# Required
SLACK_BOT_TOKEN=xoxb-your-bot-token

# Optional
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_APP_TOKEN=xapp-your-app-token  # Optional for Socket Mode
SLACK_CHANNEL_ID=C1234567890        # Optional for startup announcements
SLACK_DEFAULT_AGENT_TYPE=teamLeader # Optional: defaults to "teamLeader"
```

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

## Error Handling

The service provides comprehensive error handling:

- **Invalid Credentials**: Clear error messages for invalid bot tokens
- **Network Issues**: Handles connection failures with retry logic
- **Rate Limits**: Implements proper handling for Slack rate limits
- **Authorization Errors**: Rejects unauthorized users when whitelist is configured
- **Event Processing Errors**: Graceful handling of malformed Slack events

## Development

### Testing

Run tests with:

```bash
bun run test
bun run test:watch
bun run test:coverage
```

### Package Structure

```
pkg/slack/
├── SlackService.ts       # Core service implementation
├── SlackService.test.ts  # Configuration validation tests
├── integration.test.ts   # Integration tests
├── plugin.ts             # TokenRing plugin integration
├── index.ts              # Exports
├── package.json          # Package metadata
├── vitest.config.ts      # Test configuration
└── README.md             # This documentation
```

### Contribution Guidelines

- Follow existing code style and patterns
- Add unit tests for new functionality
- Update documentation for new features
- Ensure all changes work with TokenRing agent framework

## License

MIT License - see [LICENSE](./LICENSE) file for details.
