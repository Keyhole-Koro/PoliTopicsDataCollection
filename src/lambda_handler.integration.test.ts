import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import type { RawMeetingData } from '@NationalDietAPI/Raw';

import { startMockNationalDietApi, installMockGeminiCountTokens } from './testUtils/mockApis';

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
      meetingRecords: [
        {
          issueID: 'MTG-001',
          speechRecord: [
            { speechID: 'sp-1', speech: 'Opening remarks.' },
            { speechID: 'sp-2', speech: 'Minister response.' },
          ],
        } as any,
      ],
    } as RawMeetingData;

    const mockApi = await startMockNationalDietApi(dietResponse);

    process.env.NATIONAL_DIET_API_ENDPOINT = mockApi.url;
    process.env.GEMINI_MAX_INPUT_TOKEN = '100';
    process.env.GEMINI_API_KEY = 'fake-key';
    process.env.RUN_API_KEY = 'secret';
    process.env.PROMPT_QUEUE_URL = 'https://sqs.local/mock';

    const putJsonS3Mock = jest.fn().mockResolvedValue(undefined);
    const enqueuePromptsMock = jest.fn().mockResolvedValue({ queued: 0, urls: [] });

    jest.doMock('@S3/s3', () => ({
      putJsonS3: putJsonS3Mock,
      writeRunLog: jest.fn(),
    }));

    jest.doMock('@SQS/sqs', () => ({
      enqueuePromptsWithS3Batch: enqueuePromptsMock,
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
      expect(putJsonS3Mock).toHaveBeenCalled();
      expect(enqueuePromptsMock).toHaveBeenCalled();

      const queuedItems = enqueuePromptsMock.mock.calls[0][0].items;
      expect(queuedItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'chunk' }),
          expect.objectContaining({ type: 'reduce' }),
        ])
      );
    });

    await mockApi.close();
  });
});
