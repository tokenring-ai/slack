import { App } from '@slack/bolt';

import ChatService from "@token-ring/chat/ChatService";
import ChatCommandRegistry from "@token-ring/registry/ChatCommandRegistry.js";
import { runCommand } from "@token-ring/chat/runCommand";
import runChat from "@token-ring/ai-client/runChat";

import { Service } from "@token-ring/registry";
/**
 * SlackBotService bridges Slack chat to the chat engine.
 * Uses @slack/bolt for Slack API integration.
 */
export default class SlackBotService extends Service {
 name = "SlackBotService";
 description = "Provides SlackBot functionality";
 static constructorProperties = {
  botToken: {
   type: "string",
   required: true,
   description: "Slack Bot User OAuth Token (xoxb-...)"
  },
  signingSecret: {
   type: "string",
   required: true,
   description: "Slack App Signing Secret"
  },
  appToken: {
   type: "string",
   required: false,
   description: "Slack App-level token (for Socket Mode)"
  },
  channelId: {
   type: "string",
   required: false,
   description: "Default Slack channel ID to post messages to"
  },
  authorizedUserIds: {
   type: "array",
   required: false,
   description: "Array of Slack User IDs authorized to interact with the bot. If empty or undefined, allows all users for mentions/DMs."
  }
 };

 constructor({ botToken, signingSecret, appToken, channelId, authorizedUserIds }) {
  super();
  if (!botToken) {
   throw new Error("SlackBotService requires a botToken.");
  }
  if (!signingSecret) {
   throw new Error("SlackBotService requires a signingSecret.");
  }
  this.botToken = botToken;
  this.signingSecret = signingSecret;
  this.appToken = appToken;
  this.channelId = channelId;
  this.authorizedUserIds = Array.isArray(authorizedUserIds) ? authorizedUserIds : [];
  this.running = false;
  this.app = null;
 }

 // Helper method to start typing indicator
 _startTypingIndicator(responder) {
  let typingActive = true;
  const intervalId = setInterval(async () => {
   if (typingActive) {
    try {
     await responder({ type: 'typing' });
    } catch (e) {
     console.warn(`Slack typing indicator failed: ${e.message}`);
    }
   }
  }, 2000); // Slack's typing event lasts ~3s, repeat to keep it active

  return {
   stop: () => {
    typingActive = false;
    clearInterval(intervalId);
   }
  };
 }

 // Helper method to send logger output
 async _sendLoggerOutput(responder, logger) {
  if (!logger.empty()) {
   const outText = logger.getAndClearQueue().join("");
   if (outText.trim()) {
    try {
     await responder({ text: outText, mrkdwn: true });
    } catch (e) {
     console.error(`Failed to send logger output to Slack: ${e.message}`);
    }
   }
  }
 }


 /**
  * Start the Bolt app and handle Slack _events.
  * @param {TokenRingRegistry} registry - The package registry
  */
 async start(registry) {
  this.running = true;
  const chatService = registry.getFirstServiceByType(ChatService);
  const chatCommandService = registry.getFirstServiceByType(ChatCommandRegistry);

  // Create a custom logger for Slack
  const logger = new class {
   sendQueue = [];
   lastMessageType = null;

   section(sectionName, ...msgs) {
    if (this.lastMessageType !== sectionName) {
     if (this.lastMessageType) {
      this.sendQueue[this.sendQueue.length - 1] += `\u0060\u0060\u0060`;
     }
     this.sendQueue.push(`\n*${sectionName}*\n\u0060\u0060\u0060`);
     this.lastMessageType = sectionName;
    }
    this.sendQueue[this.sendQueue.length - 1] += `${msgs.join(' ')}`;
   }
   systemLine(...msgs) {
    this.section("System", " ", ...msgs, "\n");
   }

   errorLine(...msgs) {
    this.section("Error", " ", ...msgs, "\n");
   }

   warningLine(...msgs) {
    this.section("Warning", " ", ...msgs, "\n");
   }

   write(...msgs) {
    this.section("AI", ...msgs);
   }

   getAndClearQueue() {
    if (this.lastMessageType) {
     this.sendQueue[this.sendQueue.length - 1] += `\u0060\u0060\u0060`;
     this.lastMessageType = null;
    }
    return this.sendQueue.splice(0);
   }

   empty() {
    return this.sendQueue.length === 0;
   }
  }

  // Add logger to chat context
  chatService.addLogger(logger);

  // Subscribe to job queue _events for additional logging if needed
  chatService.subscribeToEvents('jobQueued', (jobInfo) => {
   logger.systemLine(`Job [${jobInfo.name}] queued. Queue length: ${jobInfo.queueLength}`);
  });

  chatService.subscribeToEvents('jobFailed', (jobInfo) => {
   logger.errorLine(`Job [${jobInfo.name}] failed:`, jobInfo.error);
  });

  // Initialize Bolt app
  this.app = new App({
   token: this.botToken,
   signingSecret: this.signingSecret,
   socketMode: !!this.appToken,
   appToken: this.appToken,
   //logLevel: 'debug',
  });

  // --- Catch-all slash command handler ---
  this.app.command(/.*/, async ({ command, ack, respond }) => {
   await ack();
   const cmdName = command.command.replace(/^\//, '');
   if (chatCommandService.getCommand(cmdName)) {
    const typing = this._startTypingIndicator(respond);
    try {
     await chatService.submitJob(
      `slack/command/${cmdName}`,
      runCommand,
      [cmdName, command.text, registry]
     );
    } finally {
     typing.stop();
    }
    await this._sendLoggerOutput(respond, logger);
   } else {
    await respond(`Unknown command: /${cmdName}`);
   }
  });

  // --- app_mention event handler (for legacy text commands) ---
  this.app.event('app_mention', async ({ event, say, _context }) => {
   let { user, text } = event; // Removed 'channel' as it wasn't used

   if (this.authorizedUserIds.length > 0 && !this.authorizedUserIds.includes(user)) {
    await say({ text: "Sorry, you are not authorized to use this command." });
    return;
   }

   if (!this.running) return;

   text = text.replace(/^<.*?> /,"");
   const typing = this._startTypingIndicator(say);

   try {
    const commandMatch = text.match(/^\/(\w+)\s*(.*)?$/);
    if (commandMatch) {
     await chatService.submitJob(
      `slack/mention/command/${commandMatch[1]}`,
      runCommand,
      [commandMatch[1], commandMatch[2], registry]
     );
    } else if (text.trim()) {
     try {
      await chatService.submitJob(
       'slack/mention/chat',
       runChat,
       [{
        input: [{ role: "user", content: text }],
        instructions: chatService.getInstructions(),
        model: chatService.getModel()
       }, registry]
      );
      await chatService.out("\n[Chat Complete]");
     } catch (err) {
      await chatService.errorLine("Chat Error:", err instanceof Error ? err.message : String(err));
     }
    }
   } finally {
    typing.stop();
   }
   await this._sendLoggerOutput(say, logger);
  });

  // --- message.im event handler ---
  this.app.event('message.im', async ({ event, say, _context }) => {
   let { user, text } = event;

   if (this.authorizedUserIds.length > 0 && !this.authorizedUserIds.includes(user)) {
    await say({ text: "Sorry, you are not authorized to interact with me." });
    return;
   }

   if (event.bot_id || !text) {
    return;
   }
   if (!this.running) return;

   const typing = this._startTypingIndicator(say);

   try {
    const commandMatch = text.match(/^\/(\w+)\s*(.*)?$/);
    if (commandMatch) {
     const commandName = commandMatch[1];
     const commandArgs = commandMatch[2] || "";
     await chatService.submitJob(
      `slack/dm/command/${commandName}`,
      runCommand,
      [commandName, commandArgs, registry]
     );
    } else if (text.trim()) {
     try {
      await chatService.submitJob(
       'slack/dm/chat',
       runChat,
       [{
        input: [{ role: "user", content: text }],
        instructions: chatService.getInstructions(),
        model: chatService.getModel()
       }, registry]
      );
     } catch (err) {
      await chatService.errorLine("Chat Error in DM:", err instanceof Error ? err.message : String(err));
     }
    }
   } finally {
    typing.stop();
   }
   await this._sendLoggerOutput(say, logger);
  });

  // Start the Bolt app
  await this.app.start();
  if (this.channelId) {
   await this.app.client.chat.postMessage({ channel: this.channelId, text: "Slack bot is online!" });
  }

  // Return a stop function that calls the consolidated stop method
  return () => this.stop(registry); // Pass registry if needed by the consolidated stop
 }


 /**
  * Get the bot token
  */
 getBotToken() {
  return this.botToken;
 }

 /**
  * Get the current channel ID
  */
 getChannelId() {
  return this.channelId;
 }

 /**
  * Yield the most recent 10 messages in the specified channel as chat memories.
  * @param {string} channelId - The ID of the channel to fetch memories from.
  */
 async *getMemories(channelId) {
  if (!this.app || !channelId) {
   return;
  }

  try {
   const result = await this.app.client.conversations.history({
    channel: channelId,
    limit: 10 // Fetch 10 most recent messages.
   });

   if (result && Array.isArray(result.messages)) {
    // Messages are returned newest-first by default. Reverse for chronological order if needed by consumer.
    // For memory, newest first might be fine or even preferred.
    // Here, yielding them as they are (newest first).
    for (const msg of result.messages) { // Iterate directly, no reverse, no pop
     if (msg.type === 'message' && msg.text) {
      const { name: botName } = msg.bot_profile ?? {};
      if (botName) {
       yield {role: "assistant", content: msg.text};
      } else {
       yield {role: "user", content: msg.text};
      }
     }
    }
   }
  } catch (err) {
   // Optionally log error
   // console.error("SlackBotService.getMemories error:", err);
  }
 }


 async stop(registry) {
  // Clean up service
  console.log("SlackBotService stopping");
 }

 /**
  * Reports the status of the service.
  * @param {TokenRingRegistry} registry - The package registry
  * @returns {Object} Status information.
  */
 async status(registry) {
  return {
   active: true,
   service: "SlackBotService"
  };
 }}