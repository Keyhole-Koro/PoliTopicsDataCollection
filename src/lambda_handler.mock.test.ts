import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import type { RawMeetingData } from '@NationalDietAPI/Raw';

import { installMockGeminiCountTokens } from './testUtils/mockApis';
import fetchNationalDietRecords from '@NationalDietAPI/NationalDietAPI';

describe('lambda_handler integration with mocked external APIs', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  test('processes meetings using mocked National Diet and Gemini APIs', async () => {
    const dietResponse: RawMeetingData = {
      numberOfRecords: 1,
      numberOfReturn: 1,
      startRecord: 1,
      nextRecordPosition: 0,
      meetingRecord: [
        {
          issueID: 'MTG-001',
          imageKind: 'text',
          searchObject: 0,
          session: 208,
          nameOfHouse: 'House of Representatives',
          nameOfMeeting: 'Budget Committee',
          issue: 'Budget Deliberations',
          date: '2024-09-24',
          closing: null,
          speechRecord: [
            {
              speechID: 'sp-1',
              speechOrder: 1,
              speaker: 'Member A',
              speakerYomi: null,
              speakerGroup: null,
              speakerPosition: null,
              speakerRole: null,
              speech: 'Opening remarks.',
              startPage: 1,
              createTime: new Date().toISOString(),
              updateTime: new Date().toISOString(),
              speechURL: 'https://example.com/sp-1',
            },
            {
              speechID: 'sp-2',
              speechOrder: 2,
              speaker: 'Minister B',
              speakerYomi: null,
              speakerGroup: null,
              speakerPosition: null,
              speakerRole: null,
              speech: 'Minister response.',
              startPage: 2,
              createTime: new Date().toISOString(),
              updateTime: new Date().toISOString(),
              speechURL: 'https://example.com/sp-2',
            },
          ],
        },
      ],
    };

    jest.spyOn(global, 'fetch' as any).mockImplementation(async () => ({
      ok: true,
      statusText: 'OK',
      json: async () => dietResponse,
    } as Response));

    process.env.NATIONAL_DIET_API_ENDPOINT = 'https://mock.ndl.go.jp/api/meeting';
    process.env.GEMINI_MAX_INPUT_TOKEN = '100';
    process.env.GEMINI_API_KEY = 'fake-key';
    process.env.RUN_API_KEY = 'secret';
    const putJsonS3Mock = jest.fn().mockResolvedValue(undefined);
    const createTaskMock = jest.fn().mockResolvedValue(undefined);

    jest.doMock('@S3/s3', () => ({
      putJsonS3: putJsonS3Mock,
      writeRunLog: jest.fn(),
    }));

    jest.doMock('@DynamoDB/tasks', () => ({
      TaskRepository: jest.fn().mockImplementation(() => ({
        createTask: createTaskMock,
      })),
    }));

    installMockGeminiCountTokens(10);

    const event: APIGatewayProxyEventV2 = {
      version: '2.0',
      routeKey: '$default',
      rawPath: '/run',
      rawQueryString: '',
      headers: { 'x-api-key': 'secret' },
      requestContext: {
        accountId: 'acc',
        apiId: 'api',
        domainName: 'example.com',
        domainPrefix: 'api',
        http: {
          method: 'GET',
          path: '/run',
          protocol: 'HTTP/1.1',
          sourceIp: '127.0.0.1',
          userAgent: 'jest',
        },
        requestId: 'id',
        routeKey: '$default',
        stage: '$default',
        time: 'now',
        timeEpoch: Date.now(),
      },
      isBase64Encoded: false,
    } as any;

    await jest.isolateModulesAsync(async () => {
      const { handler } = await import('./lambda_handler');
      const response = await handler(event, {} as any, () => undefined);

      expect(response.statusCode).toBe(200);
      expect(createTaskMock).toHaveBeenCalled();

      const task = createTaskMock.mock.calls[0][0];
      expect(task).toEqual(expect.objectContaining({ pk: 'MTG-001', status: 'pending' }));
      expect(task.prompt_url).toMatch(/^s3:\/\/politopics-prompts\/prompts\//);
      expect(['direct', 'chunked']).toContain(task.processingMode);

      const reducePromptCalls = putJsonS3Mock.mock.calls.filter((call) => call[0]?.key?.includes('/reduce/'));
      expect(reducePromptCalls.length).toBeGreaterThan(0);

      if (task.processingMode === 'chunked') {
        const chunkPrompts = putJsonS3Mock.mock.calls.filter((call) => call[0]?.key?.startsWith('prompts/MTG-001_'));
        expect(chunkPrompts.length).toBeGreaterThan(0);
        expect(task.chunks.length).toBeGreaterThan(0);
        expect(task.chunks.every((chunk: any) => chunk.status === 'notReady')).toBe(true);
      } else {
        expect(task.chunks.length).toBe(0);
      }
    });

    (global.fetch as jest.Mock | undefined)?.mockRestore();
  });
});
