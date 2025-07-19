# Slack Bot Service (`SlackBotService.js`)

This document explains how to configure and use the `SlackBotService`, which integrates with Slack to enable bot interactions within your workspace.

## Prerequisites

- A Slack workspace where you have permission to create and manage apps.
- **Slack Bot Token (`botToken`)**: An OAuth token that starts with `xoxb-`. This token allows the bot to connect to Slack and perform actions.
- **Slack Signing Secret (`signingSecret`)**: Used by Slack to verify that incoming requests are genuinely from Slack. This is required if not using Socket Mode.
- **Slack App-Level Token (`appToken`) (Optional)**: An app-level token that starts with `xapp-`. Required if you want to use Socket Mode instead of HTTP for event delivery. Socket Mode is generally recommended for development or if you cannot expose a public HTTP endpoint.
- **Default Channel ID (`channelId`) (Optional)**: The ID of a Slack channel (e.g., `C1234567890`) where the bot can post initial announcements (like "bot is online"). Event-specific interactions occur in the channel of the event itself.
- **Authorized User IDs (`authorizedUserIds`) (Optional)**: A comma-separated list of Slack User IDs (e.g., `U06T1LWJG,UABCDEF123`) that are authorized to interact with certain bot features. If not provided, authorization behavior may vary (currently, it restricts some interactions if not set, this will be made more explicit or default to open if not provided in future updates to the service).

## Configuration Steps

1.  **Create a Slack App and Bot User**
    *   Go to [https://api.slack.com/apps](https://api.slack.com/apps) and click "Create New App".
    *   Choose "From scratch", name your app, and select your workspace.
    *   Navigate to "Bot Users" under "Features" in the sidebar and add a bot user.
    *   Go to "OAuth & Permissions" under "Settings" in the sidebar. Add the following **Bot Token Scopes**:
        *   `channels:history` (to read channel messages, e.g., for context)
        *   `chat:write` (to send messages)
        *   `channels:read` (to get channel info)
        *   `users:read` (if you need to map user IDs to names, optional for basic operation)
        *   `commands` (if you are using Slash Commands)
        *   `app_mentions:read` (to receive @mentions)
        *   `im:history`, `im:read`, `im:write` (for Direct Message functionality)
    *   Install the app to your workspace. After installation, you will receive a **Bot User OAuth Token** (this is your `botToken`).

2.  **Retrieve App Credentials**
    *   **Signing Secret**: Navigate to "Basic Information" under "Settings". Your **Signing Secret** is available in the "App Credentials" section.
    *   **App-Level Token (for Socket Mode)**: If using Socket Mode, go to "Socket Mode" under "Settings" and enable it. You may need to generate an app-level token here. This token will be your `appToken`.
    *   **Channel ID**: To get a specific channel's ID, open Slack, right-click the channel name, select "View channel details", and you'll find the ID (usually starting with `C`) at the bottom of the pop-up.

3.  **Set Environment Variables or Configuration**
    Provide the following configuration to the `SlackBotService`, typically via environment variables:
    *   `SLACK_BOT_TOKEN`: Your Slack Bot User OAuth Token (e.g., `xoxb-...`).
    *   `SLACK_SIGNING_SECRET`: Your Slack App's Signing Secret.
    *   `SLACK_APP_TOKEN` (Optional): Your Slack App-level token (e.g., `xapp-...`) if using Socket Mode.
    *   `SLACK_CHANNEL_ID` (Optional): The default Slack channel ID for announcements.
    *   `SLACK_AUTHORIZED_USER_IDS` (Optional): A comma-separated string of user IDs authorized to use the bot (e.g., "U012ABC3DE,U456XYZ7FG").

## Usage

- Initialize the `SlackBotService` with the necessary tokens and IDs.
- The bot uses Slack's **Events API** (either via HTTP POST requests to an endpoint you expose, or via Socket Mode) to receive messages and events in real-time. It does **not** use polling for new messages.
- It processes commands and chat input, then sends messages back to the relevant channel or DM.

## Example

```javascript
const { SlackBotService } = require('./SlackBotService'); // Adjust path as necessary

// Configuration sourced from environment variables
const botToken = process.env.SLACK_BOT_TOKEN;
const signingSecret = process.env.SLACK_SIGNING_SECRET;
const appToken = process.env.SLACK_APP_TOKEN; // Optional, for Socket Mode
const channelId = process.env.SLACK_CHANNEL_ID; // Optional
const authorizedUserIdsString = process.env.SLACK_AUTHORIZED_USER_IDS; // Optional

const authorizedUserIds = authorizedUserIdsString ? authorizedUserIdsString.split(',') : [];

// Ensure required tokens are present
if (!botToken || !signingSecret) {
  throw new Error("SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET must be provided.");
}

const slackBotService = new SlackBotService({
  botToken,
  signingSecret,
  appToken, // Will enable Socket Mode if present
  channelId,
  authorizedUserIds // Pass the array of authorized user IDs
});

// Start the bot (assuming it's part of a larger application framework that calls start())
// await slackBotService.start(registry); // 'registry' would be your application's service registry
```

## Notes

- **Socket Mode vs. HTTP**: If `appToken` is provided, Socket Mode will be enabled. Otherwise, the bot will expect to receive events via HTTP, requiring your application to expose an endpoint for Slack to call.
- **Bot Invitation**: Make sure the bot has been invited to any channels where it is expected to operate or read messages (e.g., `/invite @YourBotName`).
- **User Authorization**: The `authorizedUserIds` configuration allows you to restrict access to the bot's functionalities. If this list is empty or not provided, access might be open or restricted by default depending on future service updates (currently, it's restrictive for mentions/DMs without this).
- **Extensibility**: For advanced usage, you can extend `SlackBotService.js` or the services it interacts with (like `ChatService`, `ChatCommandRegistry`) to handle more Slack events, interactive components, or custom command logic.

If you encounter any issues or have questions, please refer to the [Slack API documentation](https://api.slack.com/) or reach out for support within your project.
