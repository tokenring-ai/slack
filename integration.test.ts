import {App} from '@slack/bolt';
import AgentManagerImpl from '@tokenring-ai/agent/services/AgentManager';
import createTestingAgent from "@tokenring-ai/agent/test/createTestingAgent";
import TokenRingApp from '@tokenring-ai/app';
import createTestingApp from "@tokenring-ai/app/test/createTestingApp";
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import SlackService, {SlackServiceConfig} from './SlackService';

const mockWaitForAbort = vi.fn();
vi.mock('@tokenring-ai/utility/promise/waitForAbort', () => ({
  default: (...args: any[]) => mockWaitForAbort(...args),
}));

// Replace the App import
vi.mock('@slack/bolt', () => {
  return {
    App: vi.fn().mockImplementation(function() {
      return {
        command: vi.fn(),
        event: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        client: {
          chat: {
            postMessage: vi.fn(),
          },
        },
      };
    }),
  };
});

describe('Slack Integration Tests', () => {
  let mockApp: TokenRingApp;
  let slackService: SlackService;

  const mockConfig: SlackServiceConfig = {
    botToken: 'xoxb-test-token',
    signingSecret: 'test-signing-secret',
    appToken: 'xapp-test-token',
    channelId: 'C1234567890',
    authorizedUserIds: ['U06T1LWJG', 'UABCDEF123'],
    defaultAgentType: 'teamLeader'
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockApp = createTestingApp();
    const agentManager = new AgentManagerImpl(mockApp);
    mockApp.addServices(agentManager);
    
    // Spy on spawnAgent and return a testing agent
    vi.spyOn(agentManager, 'spawnAgent').mockImplementation(async (config) => {
        const agent = createTestingAgent(mockApp);
        vi.spyOn(agent, 'handleInput').mockReturnValue('request-1' as any);
        vi.spyOn(agent, 'subscribeState').mockReturnValue(vi.fn());
        vi.spyOn(agent, 'waitForState').mockResolvedValue({
            getEventCursorFromCurrentPosition: vi.fn().mockReturnValue({}),
            yieldEventsByCursor: vi.fn().mockReturnValue([]),
        } as any);
        return agent;
    });

    slackService = new SlackService(mockApp, mockConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('service initialization', () => {
    it('should initialize SlackService with valid config', () => {
      expect(slackService).toBeDefined();
      expect(slackService.name).toBe('SlackService');
    });

    it('should create Slack App with correct configuration', async () => {
      const mockAbortSignal = { aborted: false } as AbortSignal;
      await slackService.run(mockAbortSignal);

      expect(App).toHaveBeenCalledWith({
        token: 'xoxb-test-token',
        signingSecret: 'test-signing-secret',
        socketMode: true,
        appToken: 'xapp-test-token',
      });

      const mockSlackApp = (App as any).mock.results[0].value;
      expect(mockSlackApp.start).toHaveBeenCalled();
    });

    it('should handle minimal configuration', () => {
      const minimalConfig: SlackServiceConfig = {
        botToken: 'xoxb-minimal',
        signingSecret: 'minimal-secret',
      };

      const minimalService = new SlackService(minimalConfig, mockApp);
      expect(minimalService).toBeDefined();
    });
  });

  describe('configuration integration', () => {
    it('should handle different config scenarios', () => {
      // Test with full config
      const fullService = new SlackService(mockConfig, mockApp);
      expect(fullService).toBeDefined();

      // Test with minimal config
      const minimalConfig: SlackServiceConfig = {
        botToken: 'xoxb-minimal',
        signingSecret: 'minimal-secret',
      };
      const minimalService = new SlackService(minimalConfig, mockApp);
      expect(minimalService).toBeDefined();

      // Test with empty authorized list
      const openConfig: SlackServiceConfig = {
        botToken: 'xoxb-open',
        signingSecret: 'open-secret',
        authorizedUserIds: [],
      };
      const openService = new SlackService(openConfig, mockApp);
      expect(openService).toBeDefined();
    });

  });

  describe('agent management integration', () => {
    it('should manage user agents correctly', async () => {
      const mockAbortSignal = { aborted: false } as AbortSignal;
      await slackService.run(mockAbortSignal);

      // Get agent for user 1
      const agent1 = await (slackService as any).getOrCreateAgentForUser('U06T1LWJG');
      expect(agent1).toBeDefined();

      // Get agent for user 2
      const agent2 = await (slackService as any).getOrCreateAgentForUser('UABCDEF123');
      expect(agent2).toBeDefined();

      // Same user should get same agent
      const agent1Again = await (slackService as any).getOrCreateAgentForUser('U06T1LWJG');
      expect(agent1Again).toBe(agent1);
    });

    it('should handle agent lifecycle properly', async () => {
      const mockAbortSignal = { aborted: false } as AbortSignal;
      await slackService.run(mockAbortSignal);

      // Create some agents
      await (slackService as any).getOrCreateAgentForUser('U06T1LWJG');
      await (slackService as any).getOrCreateAgentForUser('UABCDEF123');

      // Verify agents were created
      expect((slackService as any).userAgents.size).toBe(2);

      // Simulate shutdown - get the callback passed to waitForAbort
      const abortCallback = mockWaitForAbort.mock.calls[0][1];
      
      const agentManager = mockApp.requireService(AgentManagerImpl);
      const deleteAgentSpy = vi.spyOn(agentManager, 'deleteAgent');

      await abortCallback({} as any);

      expect(deleteAgentSpy).toHaveBeenCalledTimes(2);
      expect((slackService as any).userAgents.size).toBe(0);
    });
  });

  describe('error handling integration', () => {
    it('should handle agent creation failures', async () => {
      const failingApp = createTestingApp();
      const agentManager = new AgentManagerImpl(failingApp);
      failingApp.addServices(agentManager);
      vi.spyOn(agentManager, 'spawnAgent').mockRejectedValue(new Error('Agent creation failed'));

      const failingService = new SlackService(failingApp,mockConfig);
      const mockAbortSignal = { aborted: false } as AbortSignal;
      await failingService.run(mockAbortSignal);

      // Should handle the error gracefully
      await expect((failingService as any).getOrCreateAgentForUser('U06T1LWJG'))
        .rejects.toThrow('Agent creation failed');
    });
  });

  describe('authorization integration', () => {
    it('should handle authorization checks correctly', () => {
      // Test with specific authorized users
      const restrictedService = new SlackService({
        ...mockConfig,
        authorizedUserIds: ['U06T1LWJG'] // Only first user authorized
      }, mockApp);

      expect(restrictedService).toBeDefined();

      // Test with no authorized users (all allowed)
      const openService = new SlackService({
        ...mockConfig,
        authorizedUserIds: []
      }, mockApp);

      expect(openService).toBeDefined();
    });
  });

  describe('service lifecycle integration', () => {
    it('should handle service startup and shutdown', async () => {
      const mockAbortSignal = { aborted: false } as AbortSignal;

      // Start service
      await slackService.run(mockAbortSignal);
      const mockSlackApp = (App as any).mock.results[0].value;
      expect(mockSlackApp.start).toHaveBeenCalled();

      // Verify service is running
      expect((slackService as any).running).toBe(true);

      // Simulate shutdown
      const abortCallback = mockWaitForAbort.mock.calls[0][1];
      
      await abortCallback({} as any);

      expect(mockSlackApp.stop).toHaveBeenCalled();
      expect((slackService as any).running).toBe(false);
    });

    it('should handle multiple service instances', async () => {
      const mockAbortSignal = { aborted: false } as AbortSignal;

      // First service
      await slackService.run(mockAbortSignal);
      expect(App).toHaveBeenCalledTimes(1);

      // Second service
      const secondService = new SlackService(mockConfig, mockApp);
      await secondService.run(mockAbortSignal);
      expect(App).toHaveBeenCalledTimes(2);

      // Services should be independent
      expect(slackService).not.toBe(secondService);
    });
  });
});