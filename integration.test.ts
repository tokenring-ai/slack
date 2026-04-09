import {App} from '@slack/bolt';
import AgentManagerImpl from '@tokenring-ai/agent/services/AgentManager';
import createTestingAgent from "@tokenring-ai/agent/test/createTestingAgent";
import TokenRingApp from '@tokenring-ai/app';
import createTestingApp from "@tokenring-ai/app/test/createTestingApp";
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {type ParsedSlackServiceConfig} from './schema';
import SlackService from './SlackService';

const mockWaitForAbort = vi.fn();
vi.mock('@tokenring-ai/utility/promise/waitForAbort', () => ({
  default: (...args: any[]) => mockWaitForAbort(...args),
}));

// Replace the App import with proper mocking
vi.mock('@slack/bolt', () => {
  const mockClient: any = {
    auth: {
      test: vi.fn().mockResolvedValue({
        user_id: 'UBOT123',
        user: 'test-bot',
        team_id: 'T123',
      }),
    },
    chat: {
      postMessage: vi.fn().mockResolvedValue({
        channel: 'C123',
        ts: '1234567890.123456',
        ok: true,
      }),
      update: vi.fn().mockResolvedValue({ ok: true, ts: '1234567890.123456' }),
    },
  };

  return {
    App: vi.fn().mockImplementation(function() {
      return {
        command: vi.fn(),
        event: vi.fn(),
        message: vi.fn(),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        client: mockClient,
      };
    }),
  };
});

describe('Slack Integration Tests', () => {
  let mockApp: TokenRingApp;
  let slackService: SlackService;

  const mockConfig: ParsedSlackServiceConfig = {
    bots: {
      'test-bot': {
        name: 'test-bot',
        botToken: 'xoxb-test-token',
        signingSecret: 'test-signing-secret',
        appToken: 'xapp-test-token',
        channels: {
          'engineering': {
            channelId: 'C1234567890',
            allowedUsers: ['U06T1LWJG', 'UABCDEF123'],
            agentType: 'leader'
          }
        },
        dmAgentType: 'leader',
        dmAllowedUsers: ['U06T1LWJG'],
        maxFileSize: 20_971_520
      }
    }
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
      expect(slackService.description).toBe('Manages multiple Slack bots for interacting with TokenRing agents.');
    });

    it('should create Slack Bot with correct configuration', async () => {
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

    it('should handle minimal bot configuration', () => {
      const minimalConfig: ParsedSlackServiceConfig = {
        bots: {
          'minimal-bot': {
            name: 'minimal-bot',
            botToken: 'xoxb-minimal',
            signingSecret: 'minimal-secret',
            channels: {}
          }
        }
      };

      const minimalService = new SlackService(mockApp, minimalConfig);
      expect(minimalService).toBeDefined();
      expect(minimalService.name).toBe('SlackService');
    });
  });

  describe('configuration integration', () => {
    it('should handle different bot configurations', () => {
      // Test with full config
      const fullService = new SlackService(mockApp, mockConfig);
      expect(fullService).toBeDefined();

      // Test with multiple bots
      const multiBotConfig: ParsedSlackServiceConfig = {
        bots: {
          'bot1': {
            name: 'bot1',
            botToken: 'xoxb-bot1',
            signingSecret: 'secret1',
            channels: {
              'channel1': {
                channelId: 'C111',
                allowedUsers: [],
                agentType: 'leader'
              }
            }
          },
          'bot2': {
            name: 'bot2',
            botToken: 'xoxb-bot2',
            signingSecret: 'secret2',
            channels: {
              'channel2': {
                channelId: 'C222',
                allowedUsers: ['U123'],
                agentType: 'researcher'
              }
            }
          }
        }
      };

      const multiService = new SlackService(mockApp, multiBotConfig);
      expect(multiService).toBeDefined();
    });

    it('should handle empty channels configuration', () => {
      const emptyChannelsConfig: ParsedSlackServiceConfig = {
        bots: {
          'empty-bot': {
            name: 'empty-bot',
            botToken: 'xoxb-empty',
            signingSecret: 'empty-secret',
            channels: {},
            dmAgentType: 'leader',
            dmAllowedUsers: []
          }
        }
      };

      const emptyService = new SlackService(mockApp, emptyChannelsConfig);
      expect(emptyService).toBeDefined();
    });
  });

  describe('bot management integration', () => {
    it('should manage multiple bots correctly', async () => {
      const multiBotConfig: ParsedSlackServiceConfig = {
        bots: {
          'bot1': {
            name: 'bot1',
            botToken: 'xoxb-bot1',
            signingSecret: 'secret1',
            channels: {
              'channel1': {
                channelId: 'C111',
                allowedUsers: [],
                agentType: 'leader'
              }
            }
          },
          'bot2': {
            name: 'bot2',
            botToken: 'xoxb-bot2',
            signingSecret: 'secret2',
            channels: {
              'channel2': {
                channelId: 'C222',
                allowedUsers: [],
                agentType: 'researcher'
              }
            }
          }
        }
      };

      const multiService = new SlackService(mockApp, multiBotConfig);
      const mockAbortSignal = { aborted: false } as AbortSignal;
      await multiService.run(mockAbortSignal);

      // Get available bots
      const availableBots = multiService.getAvailableBots();
      expect(availableBots).toEqual(['bot1', 'bot2']);

      // Get specific bots
      const bot1 = multiService.getBot('bot1');
      const bot2 = multiService.getBot('bot2');
      expect(bot1).toBeDefined();
      expect(bot2).toBeDefined();

      // Get non-existent bot
      const nonExistent = multiService.getBot('non-existent');
      expect(nonExistent).toBeUndefined();
    });

    it('should handle bot lifecycle properly', async () => {
      const mockAbortSignal = { aborted: false } as AbortSignal;
      await slackService.run(mockAbortSignal);

      // Verify bot was started
      const mockSlackApp = (App as any).mock.results[0].value;
      expect(mockSlackApp.start).toHaveBeenCalled();

      // Simulate shutdown - get the callback passed to waitForAbort
      const abortCallback = mockWaitForAbort.mock.calls[0][1];
      
      await abortCallback({} as any);

      expect(mockSlackApp.stop).toHaveBeenCalled();
    });
  });

  describe('error handling integration', () => {
    it('should handle auth failures gracefully', async () => {
      // Create a new mock app for this test
      const failingApp = createTestingApp();
      const agentManager = new AgentManagerImpl(failingApp);
      failingApp.addServices(agentManager);
      
      // Mock spawnAgent to return a testing agent
      vi.spyOn(agentManager, 'spawnAgent').mockImplementation(async (config) => {
          const agent = createTestingAgent(failingApp);
          vi.spyOn(agent, 'handleInput').mockReturnValue('request-1' as any);
          vi.spyOn(agent, 'subscribeState').mockReturnValue(vi.fn());
          vi.spyOn(agent, 'waitForState').mockResolvedValue({
              getEventCursorFromCurrentPosition: vi.fn().mockReturnValue({}),
              yieldEventsByCursor: vi.fn().mockReturnValue([]),
          } as any);
          return agent;
      });

      const failingConfig: ParsedSlackServiceConfig = {
        bots: {
          'failing-bot': {
            name: 'failing-bot',
            botToken: 'xoxb-failing',
            signingSecret: 'failing-secret',
            channels: {}
          }
        }
      };

      // Mock auth.test to fail for this specific test
      const mockClient: any = {
        auth: {
          test: vi.fn().mockRejectedValue(new Error('Invalid token')),
        },
        chat: {
          postMessage: vi.fn(),
          update: vi.fn(),
        },
      };

      (App as any).mockImplementation(function() {
        return {
          command: vi.fn(),
          event: vi.fn(),
          message: vi.fn(),
          start: vi.fn().mockImplementation(async () => {
            await mockClient.auth.test();
          }),
          stop: vi.fn().mockResolvedValue(undefined),
          client: mockClient,
        };
      });

      const failingService = new SlackService(failingApp, failingConfig);
      const mockAbortSignal = { aborted: false } as AbortSignal;
      
      // Starting should fail due to auth
      await expect(failingService.run(mockAbortSignal)).rejects.toThrow('Invalid token');
      
      // Restore the default mock
      (App as any).mockImplementation(function() {
        const defaultMockClient: any = {
          auth: {
            test: vi.fn().mockResolvedValue({
              user_id: 'UBOT123',
              user: 'test-bot',
              team_id: 'T123',
            }),
          },
          chat: {
            postMessage: vi.fn().mockResolvedValue({
              channel: 'C123',
              ts: '1234567890.123456',
              ok: true,
            }),
            update: vi.fn().mockResolvedValue({ ok: true, ts: '1234567890.123456' }),
          },
        };
        return {
          command: vi.fn(),
          event: vi.fn(),
          message: vi.fn(),
          start: vi.fn().mockResolvedValue(undefined),
          stop: vi.fn().mockResolvedValue(undefined),
          client: defaultMockClient,
        };
      });
    });
  });

  describe('service lifecycle integration', () => {
    it('should handle service startup and shutdown', async () => {
      const mockAbortSignal = { aborted: false } as AbortSignal;

      // Start service
      await slackService.run(mockAbortSignal);
      const mockSlackApp = (App as any).mock.results[0].value;
      expect(mockSlackApp.start).toHaveBeenCalled();

      // Simulate shutdown
      const abortCallback = mockWaitForAbort.mock.calls[0][1];
      
      await abortCallback({} as any);

      expect(mockSlackApp.stop).toHaveBeenCalled();
    });

    it('should handle multiple service instances', async () => {
      const mockAbortSignal = { aborted: false } as AbortSignal;

      // First service
      await slackService.run(mockAbortSignal);
      expect(App).toHaveBeenCalledTimes(1);

      // Second service
      const secondService = new SlackService(mockApp, mockConfig);
      await secondService.run(mockAbortSignal);
      expect(App).toHaveBeenCalledTimes(2);

      // Services should be independent
      expect(slackService).not.toBe(secondService);
    });
  });

  describe('SlackBot integration', () => {
    it('should create SlackBot with correct parameters', async () => {
      const mockAbortSignal = { aborted: false } as AbortSignal;
      await slackService.run(mockAbortSignal);

      // Get the bot
      const bot = slackService.getBot('test-bot');
      expect(bot).toBeDefined();
      expect(bot!.getBotUserId()).toBe('UBOT123');
    });

    it('should handle bot stop operation', async () => {
      const mockAbortSignal = { aborted: false } as AbortSignal;
      await slackService.run(mockAbortSignal);

      const bot = slackService.getBot('test-bot');
      expect(bot).toBeDefined();

      // Stop the bot
      await bot!.stop();

      const mockSlackApp = (App as any).mock.results[0].value;
      expect(mockSlackApp.stop).toHaveBeenCalled();
    });
  });
});
