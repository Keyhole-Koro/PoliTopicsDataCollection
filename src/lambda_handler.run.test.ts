// Unit-level suite that isolates the /run handler path with mocked dependencies (fetch, DynamoDB),
// ensuring auth failures and empty-meeting responses behave correctly without touching LocalStack.
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { installMockGeminiCountTokens } from './testUtils/mockApis';

const createTaskMock = jest.fn();

jest.doMock('@DynamoDB/tasks', () => ({
  TaskRepository: jest.fn().mockImplementation(() => ({
    createTask: createTaskMock,
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
    createTaskMock.mockReset();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  /*
   Contract: guarantees /run rejects when x-api-key is missing/invalid; if it fails, auth guard is bypassed.
   Reason: API key enforcement is a business rule to prevent unauthorized task creation.
   Accident without this: deployments could expose the ingestion endpoint publicly and allow arbitrary runs.
   Odd values: none; empty headers emulate the most common misconfig.
   Bug history: none known.
  */
  test('rejects requests without a valid x-api-key header', async () => {
    await jest.isolateModulesAsync(async () => {
      const { applyLambdaTestEnv, DEFAULT_PROMPT_BUCKET } = await import('./testUtils/testEnv');
      applyLambdaTestEnv({ PROMPT_BUCKET: DEFAULT_PROMPT_BUCKET });
      const { handler } = await import('./lambda_handler');
      const event = buildEvent();
      const response = await handler(event, {} as any, () => undefined);

      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body as string)).toEqual({ error: 'unauthorized' });
    });
  });

  /*
   Contract: ensures /run returns 200 and does not enqueue tasks when upstream ND API returns no meetings; failure means handler breaks the empty-range contract.
   Reason: empty windows should be a harmless no-op; protects against accidental task creation on empty data.
   Accident without this: handler might throw or create tasks with missing data, polluting DynamoDB.
   Odd values: mock ND API returns zero meetings to explicitly hit the empty path.
   Bug history: none recorded.
  */
  test('processes /run when the API key and dependencies are configured', async () => {
    const fetchMock = jest.spyOn(globalThis as any, 'fetch').mockResolvedValue({
      ok: true,
      statusText: 'OK',
      json: async () => ({
        numberOfRecords: 0,
        numberOfReturn: 0,
        startRecord: 1,
        nextRecordPosition: 0,
        meetingRecord: [],
      }),
    } as Response);

    installMockGeminiCountTokens(10);

    await jest.isolateModulesAsync(async () => {
      const { applyLambdaTestEnv, DEFAULT_PROMPT_BUCKET } = await import('./testUtils/testEnv');
      applyLambdaTestEnv({ PROMPT_BUCKET: DEFAULT_PROMPT_BUCKET });
      const { handler } = await import('./lambda_handler');
      const event = buildEvent();
      event.headers = { 'x-api-key': 'secret' };

      const response = await handler(event, {} as any, () => undefined);

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body as string)).toEqual({ message: 'No meetings found for the specified range.' });
      expect(fetchMock).toHaveBeenCalled();
      expect(createTaskMock).not.toHaveBeenCalled();
    });

    fetchMock.mockRestore();
  });
});
