# Slack Service

Integrates Slack with TokenRing agents, enabling bot interactions within your workspace. Each Slack user gets their own persistent agent instance that maintains conversation history.

## Prerequisites

- Slack workspace with app creation permissions
- **Bot Token (`botToken`)**: OAuth token starting with `xoxb-`
- **Signing Secret (`signingSecret`)**: Verifies incoming Slack requests
- **App-Level Token (`appToken`)** (Optional): Token starting with `xapp-` for Socket Mode
- **Channel ID (`channelId`)** (Optional): Channel for startup announcements (e.g., `C1234567890`)
- **Authorized User IDs (`authorizedUserIds`)** (Optional): Array of user IDs allowed to use the bot
- **Default Agent Type (`defaultAgentType`)** (Optional): Agent type to create for users (defaults to first available)

## Setup

1. **Create Slack App** at [https://api.slack.com/apps](https://api.slack.com/apps)
2. **Add Bot Token Scopes**:
   - `chat:write` - Send messages
   - `app_mentions:read` - Receive @mentions
   - `im:history`, `im:read`, `im:write` - Direct messages
   - `commands` - Slash commands (optional)
3. **Install to workspace** and copy the Bot User OAuth Token
4. **Get Signing Secret** from "Basic Information" > "App Credentials"
5. **Enable Socket Mode** (optional) and generate app-level token
6. **Invite bot** to channels: `/invite @YourBotName`

## Configuration

```typescript
import SlackService from '@tokenring-ai/slack/SlackBotService';
import { AgentTeam } from '@tokenring-ai/agent';

const slackService = new SlackService({
  botToken: process.env.SLACK_BOT_TOKEN!,
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  appToken: process.env.SLACK_APP_TOKEN, // Optional, enables Socket Mode
  channelId: process.env.SLACK_CHANNEL_ID, // Optional
  authorizedUserIds: ['U06T1LWJG', 'UABCDEF123'], // Optional
  defaultAgentType: 'teamLeader' // Optional
});

const agentTeam = new AgentTeam(config);
await agentTeam.addServices(slackService);
await slackService.start(agentTeam);
```

## Features

- **Per-User Agents**: Each Slack user gets a dedicated agent with persistent chat history
- **Slash Commands**: Forward to agent's command system (e.g., `/help`, `/reset`)
- **@Mentions**: Respond to mentions in channels
- **Direct Messages**: Private conversations with the bot
- **Socket Mode**: No public endpoint required for development
- **Authorization**: Optional user whitelist

## Usage

- **Mention**: `@BotName what is the weather?`
- **DM**: Send direct message to bot
- **Commands**: `/help` or `@BotName /reset`

## Notes

- Socket Mode enabled when `appToken` provided, otherwise uses HTTP events
- Each user's agent maintains independent conversation state
- Agents are cleaned up when service stops
- If `authorizedUserIds` is empty, all users can interact (set list to restrict access)
