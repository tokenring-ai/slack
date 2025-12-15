import {App} from '@slack/bolt';
import {AgentEventState} from "@tokenring-ai/agent/state/agentEventState";
import TokenRingApp from "@tokenring-ai/app";
import {Agent, AgentManager} from "@tokenring-ai/agent";

import {TokenRingService} from "@tokenring-ai/app/types";
import waitForAbort from "@tokenring-ai/utility/promise/waitForAbort";
import {z} from "zod";

export const SlackServiceConfigSchema = z.object({
  botToken: z.string().min(1, "Bot token is required"),
  signingSecret: z.string().min(1, "Signing secret is required"),
  appToken: z.string().optional(),
  channelId: z.string().optional(),
  authorizedUserIds: z.array(z.string()).optional(),
  defaultAgentType: z.string().optional()
});

export type SlackServiceConfig = z.infer<typeof SlackServiceConfigSchema>;

export default class SlackService implements TokenRingService {
  name = "SlackService";
  description = "Provides a Slack bot for interacting with TokenRing agents.";
  private running = false;
  private readonly botToken: string;
  private readonly signingSecret: string;
  private readonly appToken?: string;
  private readonly channelId?: string;
  private authorizedUserIds: string[] = [];
  private readonly defaultAgentType: string;
  private slackApp: App | null = null;
  private app: TokenRingApp
  private userAgents = new Map<string, Agent>();

  constructor(app: TokenRingApp, {botToken, signingSecret, appToken, channelId, authorizedUserIds, defaultAgentType}: SlackServiceConfig) {
    if (!botToken) {
      throw new Error("SlackService requires a botToken.");
    }
    if (!signingSecret) {
      throw new Error("SlackService requires a signingSecret.");
    }
    this.app = app;
    this.botToken = botToken;
    this.signingSecret = signingSecret;
    this.appToken = appToken;
    this.channelId = channelId;
    this.authorizedUserIds = authorizedUserIds || [];
    this.defaultAgentType = defaultAgentType || "teamLeader";
  }

  async run(signal: AbortSignal): Promise<void> {
    this.running = true;

    this.slackApp = new App({
      token: this.botToken,
      signingSecret: this.signingSecret,
      socketMode: !!this.appToken,
      appToken: this.appToken,
    });

    // Handle slash commands
    this.slackApp.command(/.*/, async ({command, ack, respond}) => {
      await ack();
      const cmdName = command.command.replace(/^\//, '');
      const agent = await this.getOrCreateAgentForUser(command.user_id);

      try {
        const requestId = agent.handleInput({message: `/${cmdName} ${command.text}`});

        // Set up subscription for command response
        const unsubscribe = agent.subscribeState(AgentEventState, (state) => {
          for (const event of state.events) {
            switch (event.type) {
              case 'input.handled':
                if (event.requestId === requestId) {
                  unsubscribe();
                  break;
                }
                break;
            }
          }
        });

        // Set timeout for the response
        if (agent.config.maxRunTime > 0) {
          setTimeout(() => {
            unsubscribe();
            respond(`Command timed out after ${agent.config.maxRunTime} seconds.`);
          }, agent.config.maxRunTime * 1000);
        }
      } catch (err) {
        await respond(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    // Handle app mentions
    this.slackApp.event('app_mention', async ({event, say}) => {
      const {user, text} = event;

      if (!user || (this.authorizedUserIds.length > 0 && !this.authorizedUserIds.includes(user))) {
        await say({text: "Sorry, you are not authorized to use this bot."});
        return;
      }

      const cleanText = text.replace(/^<.*?> /, "").trim();
      if (!cleanText) return;

      const agent = await this.getOrCreateAgentForUser(user);

      // Wait for agent to be idle before sending new message
      const initialState = await agent.waitForState(AgentEventState, (state) => state.idle);
      const eventCursor = initialState.getEventCursorFromCurrentPosition();

      // Send the message to the agent
      const requestId = agent.handleInput({message: cleanText});

      // Subscribe to agent events to process the response
      const unsubscribe = agent.subscribeState(AgentEventState, (state) => {
        for (const event of state.yieldEventsByCursor(eventCursor)) {
          switch (event.type) {
            case 'output.chat':
              this.handleChatOutput(say, event.content);
              break;
            case 'output.system':
              this.handleSystemOutput(say, event.message, event.level);
              break;
            case 'input.handled':
              if (event.requestId === requestId) {
                unsubscribe();
                // If no response was sent, send a default message
                if (!this.lastResponseSent) {
                  say({text: "No response received from agent."});
                }
              }
              break;
          }
        }
      });

      // Set timeout for the response
      if (agent.config.maxRunTime > 0) {
        setTimeout(() => {
          unsubscribe();
          say({text: `Agent timed out after ${agent.config.maxRunTime} seconds.`});
        }, agent.config.maxRunTime * 1000);
      }
    });

    // Handle direct messages
    this.slackApp.event('message', async ({event, say}) => {
      if (event.subtype || event.bot_id) return;

      const {user, text, channel_type} = event as any;
      if (channel_type !== 'im' || !text) return;

      if (this.authorizedUserIds.length > 0 && !this.authorizedUserIds.includes(user)) {
        await say({text: "Sorry, you are not authorized to interact with me."});
        return;
      }

      const agent = await this.getOrCreateAgentForUser(user);

      // Wait for agent to be idle before sending new message
      const initialState = await agent.waitForState(AgentEventState, (state) => state.idle);
      const eventCursor = initialState.getEventCursorFromCurrentPosition();

      // Send the message to the agent
      const requestId = agent.handleInput({message: text});

      // Subscribe to agent events to process the response
      const unsubscribe = agent.subscribeState(AgentEventState, (state) => {
        for (const event of state.yieldEventsByCursor(eventCursor)) {
          switch (event.type) {
            case 'output.chat':
              this.handleChatOutput(say, event.content);
              break;
            case 'output.system':
              this.handleSystemOutput(say, event.message, event.level);
              break;
            case 'input.handled':
              if (event.requestId === requestId) {
                unsubscribe();
                // If no response was sent, send a default message
                if (!this.lastResponseSent) {
                  say({text: "No response received from agent."});
                }
              }
              break;
          }
        }
      });

      // Set timeout for the response
      if (agent.config.maxRunTime > 0) {
        setTimeout(() => {
          unsubscribe();
          say({text: `Agent timed out after ${agent.config.maxRunTime} seconds.`});
        }, agent.config.maxRunTime * 1000);
      }
    });

    await this.slackApp.start();
    if (this.channelId) {
      await this.slackApp.client.chat.postMessage({
        channel: this.channelId,
        text: "Slack bot is online!"
      });
    }
    return waitForAbort(signal, async (ev) => {
      const agentManager = this.app.requireService(AgentManager);

      this.running = false;

      // Clean up all user agents
      for (const [userId, agent] of this.userAgents.entries()) {
        await agentManager.deleteAgent(agent);
      }
      this.userAgents.clear();

      if (this.slackApp) {
        await this.slackApp.stop();
        this.slackApp = null;
      }
    });
  }

  private lastResponseSent = false;

  private async handleChatOutput(say: any, content: string): Promise<void> {
    // Accumulate chat content and send when complete
    this.lastResponseSent = true;
    await say({text: content});
  }

  private async handleSystemOutput(say: any, message: string, level: string): Promise<void> {
    const formattedMessage = `[${level.toUpperCase()}]: ${message}`;
    await say({text: formattedMessage});
  }


  private async getOrCreateAgentForUser(userId: string): Promise<Agent> {
    const agentManager = this.app.requireService(AgentManager);
    if (!this.userAgents.has(userId)) {
      const agent = await agentManager.spawnAgent({ agentType: this.defaultAgentType, headless: false });
      this.userAgents.set(userId, agent);
    }
    return this.userAgents.get(userId)!;
  }
}