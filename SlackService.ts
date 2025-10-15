import { App } from '@slack/bolt';
import { Agent, AgentTeam } from "@tokenring-ai/agent";
import { TokenRingService } from "@tokenring-ai/agent/types";
import { z } from "zod";

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
  private botToken: string;
  private signingSecret: string;
  private appToken?: string;
  private channelId?: string;
  private authorizedUserIds: string[] = [];
  private defaultAgentType: string;
  private app: App | null = null;
  private agentTeam: AgentTeam | null = null;
  private userAgents = new Map<string, Agent>();

  constructor({ botToken, signingSecret, appToken, channelId, authorizedUserIds, defaultAgentType }: SlackServiceConfig) {
    if (!botToken) {
      throw new Error("SlackService requires a botToken.");
    }
    if (!signingSecret) {
      throw new Error("SlackService requires a signingSecret.");
    }
    this.botToken = botToken;
    this.signingSecret = signingSecret;
    this.appToken = appToken;
    this.channelId = channelId;
    this.authorizedUserIds = authorizedUserIds || [];
    this.defaultAgentType = defaultAgentType || "teamLeader";
  }

  private async getOrCreateAgentForUser(userId: string): Promise<Agent> {
    if (!this.userAgents.has(userId)) {
      const agent = await this.agentTeam!.createAgent(this.defaultAgentType);
      this.userAgents.set(userId, agent);
    }
    return this.userAgents.get(userId)!;
  }

  async start(agentTeam: AgentTeam): Promise<void> {
    this.running = true;
    this.agentTeam = agentTeam;

    this.app = new App({
      token: this.botToken,
      signingSecret: this.signingSecret,
      socketMode: !!this.appToken,
      appToken: this.appToken,
    });

    // Handle slash commands
    this.app.command(/.*/, async ({ command, ack, respond }) => {
      await ack();
      const cmdName = command.command.replace(/^\//, '');
      const agent = await this.getOrCreateAgentForUser(command.user_id);
      
      try {
        await agent.handleInput({ message: `/${cmdName} ${command.text}` });
      } catch (err) {
        await respond(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    // Handle app mentions
    this.app.event('app_mention', async ({ event, say }) => {
      const { user, text } = event;

      if (!user || (this.authorizedUserIds.length > 0 && !this.authorizedUserIds.includes(user))) {
        await say({ text: "Sorry, you are not authorized to use this bot." });
        return;
      }

      const cleanText = text.replace(/^<.*?> /, "").trim();
      if (!cleanText) return;

      const agent = await this.getOrCreateAgentForUser(user);
      let response = "";

      for await (const event of agent.events(new AbortController().signal)) {
        if (event.type === 'output.chat') {
          response += event.data.content;
        } else if (event.type === 'state.idle') {
          if (response) {
            await say({ text: response });
            break;
          }
          await agent.handleInput({ message: cleanText });
          response = "";
        }
      }
    });

    // Handle direct messages
    this.app.event('message', async ({ event, say }) => {
      if (event.subtype || event.bot_id) return;
      
      const { user, text, channel_type } = event as any;
      if (channel_type !== 'im' || !text) return;

      if (this.authorizedUserIds.length > 0 && !this.authorizedUserIds.includes(user)) {
        await say({ text: "Sorry, you are not authorized to interact with me." });
        return;
      }

      const agent = await this.getOrCreateAgentForUser(user);
      let response = "";

      for await (const event of agent.events(new AbortController().signal)) {
        if (event.type === 'output.chat') {
          response += event.data.content;
        } else if (event.type === 'state.idle') {
          if (response) {
            await say({ text: response });
            break;
          }
          await agent.handleInput({ message: text });
          response = "";
        }
      }
    });

    await this.app.start();
    if (this.channelId) {
      await this.app.client.chat.postMessage({ 
        channel: this.channelId, 
        text: "Slack bot is online!" 
      });
    }
  }

  async stop(agentTeam: AgentTeam): Promise<void> {
    this.running = false;
    
    // Clean up all user agents
    for (const [userId, agent] of this.userAgents.entries()) {
      await agentTeam.deleteAgent(agent);
    }
    this.userAgents.clear();

    if (this.app) {
      await this.app.stop();
      this.app = null;
    }
  }
}
