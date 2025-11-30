import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { installMockGeminiCountTokens } from './testUtils/mockApis';

const putMapTasksMock = jest.fn();
const putReduceTaskMock = jest.fn();

jest.doMock('@DynamoDB/tasks', () => ({
  TaskRepository: jest.fn().mockImplementation(() => ({
    putMapTasks: putMapTasksMock,
    putReduceTask: putReduceTaskMock,
  })),
}));

describe('lambda_handler run endpoint', () => {
  const ORIGINAL_ENV = process.env;

  const buildEvent = (): APIGatewayProxyEventV2 => ({
    version: '2.0',
    routeKey: '$default',
    rawPath: '/run',
    rawQueryString: 'from=2025-09-01&until=2025-09-02',
    headers: {},
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
  } as APIGatewayProxyEventV2);

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    putMapTasksMock.mockReset();
    putReduceTaskMock.mockReset();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  test('rejects requests without a valid x-api-key header', async () => {
    process.env.RUN_API_KEY = 'secret';
    process.env.GEMINI_MAX_INPUT_TOKEN = '1200';
    process.env.GEMINI_API_KEY = 'fake';

    await jest.isolateModulesAsync(async () => {
      const { handler } = await import('./lambda_handler');
      const event = buildEvent();
      const response = await handler(event, {} as any, () => undefined);

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body as string)).toEqual({ error: 'unauthorized' });
    });
  });

  test('processes /run when the API key and dependencies are configured', async () => {
    process.env.RUN_API_KEY = 'secret';
    process.env.GEMINI_MAX_INPUT_TOKEN = '1200';
    process.env.GEMINI_API_KEY = 'fake';
    process.env.NATIONAL_DIET_API_ENDPOINT = 'https://kokkai.ndl.go.jp/api/meeting';

    const fetchMock = jest.spyOn(globalThis as any, 'fetch').mockResolvedValue({
      ok: true,
      statusText: 'OK',
      json: async () => ({
        numberOfRecords: 0,
        numberOfReturn: 0,
        startRecord: 1,
        nextRecordPosition: null,
        meetingRecord: [],
      }),
    } as Response);

    const putMapTasksMock = jest.fn().mockResolvedValue(undefined);
    const putReduceTaskMock = jest.fn().mockResolvedValue(undefined);

    jest.doMock('@DynamoDB/tasks', () => ({
      TaskRepository: jest.fn().mockImplementation(() => ({
        putMapTasks: putMapTasksMock,
        putReduceTask: putReduceTaskMock,
      })),
    }));

    installMockGeminiCountTokens(10);

    await jest.isolateModulesAsync(async () => {
      const { handler } = await import('./lambda_handler');
      const event = buildEvent();
      event.headers = { 'x-api-key': 'secret' };

      const response = await handler(event, {} as any, () => undefined);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body as string)).toEqual({ message: 'No meetings found for the specified range.' });
      expect(fetchMock).toHaveBeenCalled();
      expect(putMapTasksMock).not.toHaveBeenCalled();
      expect(putReduceTaskMock).not.toHaveBeenCalled();
    });

    fetchMock.mockRestore();
  });
});
