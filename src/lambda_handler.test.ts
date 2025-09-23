import type { APIGatewayProxyEventV2 } from 'aws-lambda';

jest.mock('@S3/s3', () => ({
  putJsonS3: jest.fn(),
  writeRunLog: jest.fn(),
}));

jest.mock('@SQS/sqs', () => ({
  enqueuePromptsWithS3Batch: jest.fn().mockResolvedValue({ queued: 0, urls: [] }),
}));

jest.mock('@google/generative-ai', () => {
  const countTokensMock = jest.fn().mockResolvedValue({ totalTokens: 10 });
  const getGenerativeModelMock = jest.fn().mockReturnValue({ countTokens: countTokensMock });
  return {
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({ getGenerativeModel: getGenerativeModelMock })),
    __mocks: { countTokensMock, getGenerativeModelMock },
  };
});

jest.mock('@prompts/prompts', () => ({
  prompt: jest.fn(() => 'PROMPT_TEMPLATE'),
}));

jest.mock('@utils/aws', () => ({
  getAwsRegion: jest.fn(() => 'ap-northeast-1'),
}));

jest.mock('@NationalDietAPI/NationalDietAPI', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const defaultEvent: APIGatewayProxyEventV2 = {
  version: '2.0',
  routeKey: '$default',
  rawPath: '/run',
  rawQueryString: '',
  headers: {},
  requestContext: {
    accountId: '1234567890',
    apiId: 'test',
    domainName: 'example.com',
    domainPrefix: 'test',
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
    time: 'Now',
    timeEpoch: Date.now(),
  },
  isBase64Encoded: false,
};

describe('lambda_handler prompt pipeline', () => {
  let handler: any;
  let putJsonS3Mock: jest.Mock;
  let enqueuePromptsMock: jest.Mock;
  let fetchNationalDietRecordsMock: jest.Mock;
  let promptMock: jest.Mock;
  let countTokensMock: jest.Mock;

  beforeEach(async () => {
    jest.resetModules();

    const s3Module = jest.requireMock('@S3/s3');
    putJsonS3Mock = s3Module.putJsonS3 as jest.Mock;
    putJsonS3Mock.mockReset();

    const sqsModule = jest.requireMock('@SQS/sqs');
    enqueuePromptsMock = sqsModule.enqueuePromptsWithS3Batch as jest.Mock;
    enqueuePromptsMock.mockReset();

    const apiModule = jest.requireMock('@NationalDietAPI/NationalDietAPI');
    fetchNationalDietRecordsMock = apiModule.default as jest.Mock;
    fetchNationalDietRecordsMock.mockReset();

    const promptModule = jest.requireMock('@prompts/prompts');
    promptMock = promptModule.prompt as jest.Mock;
    promptMock.mockReset();
    promptMock.mockReturnValue('PROMPT_TEMPLATE');

    const googleModule = jest.requireMock('@google/generative-ai');
    countTokensMock = googleModule.__mocks.countTokensMock as jest.Mock;
    countTokensMock.mockReset();
    countTokensMock.mockResolvedValue({ totalTokens: 10 });

    process.env.GEMINI_MAX_INPUT_TOKEN = '100';
    process.env.GOOGLE_API_KEY = 'fake-key';
    process.env.RUN_API_KEY = 'secret';
    process.env.PROMPT_QUEUE_URL = 'https://queue.example.com';

    await jest.isolateModulesAsync(async () => {
      ({ handler } = await import('./lambda_handler'));
    });
  });

  afterEach(() => {
    delete process.env.GEMINI_MAX_INPUT_TOKEN;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.RUN_API_KEY;
    delete process.env.PROMPT_QUEUE_URL;
  });

  test('uploads chunk payloads to S3 and enqueues prompt tasks', async () => {
    fetchNationalDietRecordsMock.mockResolvedValue({
      meetingRecords: [
        {
          issueID: 'MTG-123',
          nameOfMeeting: 'Budget Committee 1',
          date: '2025-09-19',
          session: 208,
          speechRecord: [
            { speechID: 'sp-1', speech: 'Opening remarks.' },
            { speechID: 'sp-2', speech: 'Response remarks.' },
            { speechID: 'sp-3', speech: 'Closing remarks.' },
          ],
        },
      ],
    });

    const event: APIGatewayProxyEventV2 = {
      ...defaultEvent,
      headers: { 'x-api-key': 'secret' },
      queryStringParameters: { from: '2025-09-19', until: '2025-09-19' },
    };

    const response = await handler(event as any, {} as any, () => undefined);

    expect(response.statusCode).toBe(200);
    expect(fetchNationalDietRecordsMock).toHaveBeenCalledWith(expect.any(String), {
      from: '2025-09-19',
      until: '2025-09-19',
    });

    expect(putJsonS3Mock).toHaveBeenCalledTimes(1);
    const putArgs = putJsonS3Mock.mock.calls[0][0];
    expect(putArgs.bucket).toBe('politopics-prompts');
    expect(putArgs.key).toBe('prompts/MTG-123_0-1-2.json');
    expect(putArgs.body).toMatchObject({
      prompt: 'PROMPT_TEMPLATE',
      speechIds: ['sp-1', 'sp-2', 'sp-3'],
      indices: [0, 1, 2],
      composedSpeech: 'Opening remarks.\n\nResponse remarks.\n\nClosing remarks.',
    });
    expect(putArgs.body.speeches).toHaveLength(3);

    expect(enqueuePromptsMock).toHaveBeenCalledWith({
      items: [
        expect.objectContaining({
          type: 'prompt',
          url: 's3://politopics-prompts/prompts/MTG-123_0-1-2.json',
          llm: 'gemini',
          llmModel: 'gemini-2.5-pro',
        }),
      ],
      queueUrl: 'https://queue.example.com',
    });

    const queuedPayload = enqueuePromptsMock.mock.calls[0][0] as { items: Array<{ meta?: any }>; };
    const [firstItem] = queuedPayload.items;
    expect(firstItem.meta).toBeDefined();
    const meta = firstItem.meta as {
      speech_ids: string[];
      indices: number[];
      totalLen: number;
      range: { from: string; until: string };
      runId: string;
      startedAt: string;
    };
    expect(meta).toMatchObject({
      speech_ids: ['sp-1', 'sp-2', 'sp-3'],
      indices: [0, 1, 2],
      range: { from: '2025-09-19', until: '2025-09-19' },
      runId: '',
    });
    expect(meta.totalLen).toBe(30);
    expect(Number.isNaN(Date.parse(meta.startedAt))).toBe(false);
  });

  test('splits prompt batches when token budget is exceeded', async () => {
    countTokensMock.mockImplementation(async ({ contents }) => {
      const text = contents?.[0]?.parts?.[0]?.text ?? '';
      if (text === 'PROMPT_TEMPLATE') return { totalTokens: 10 };
      if (text.includes('Large Opening Statement')) return { totalTokens: 70 };
      if (text.includes('Follow-up Question')) return { totalTokens: 60 };
      if (text.includes('Minister Response')) return { totalTokens: 65 };
      return { totalTokens: 5 };
    });

    fetchNationalDietRecordsMock.mockResolvedValue({
      meetingRecords: [
        {
          issueID: 'MTG-456',
          nameOfMeeting: 'Budget Committee 2',
          date: '2025-09-20',
          session: 208,
          speechRecord: [
            { speechID: 'sp-10', speech: 'Large Opening Statement' },
            { speechID: 'sp-11', speech: 'Follow-up Question' },
            { speechID: 'sp-12', speech: 'Minister Response' },
          ],
        },
      ],
    });

    const event: APIGatewayProxyEventV2 = {
      ...defaultEvent,
      headers: { 'x-api-key': 'secret' },
      queryStringParameters: { from: '2025-09-19', until: '2025-09-19' },
    };

    const response = await handler(event as any, {} as any, () => undefined);

    expect(response.statusCode).toBe(200);
    expect(putJsonS3Mock).toHaveBeenCalledTimes(3);

    const s3Calls = putJsonS3Mock.mock.calls.map((call) => call[0] as { key: string; body: any });
    expect(s3Calls.map((c) => c.key)).toEqual([
      'prompts/MTG-456_0.json',
      'prompts/MTG-456_1.json',
      'prompts/MTG-456_2.json',
    ]);

    s3Calls.forEach((args, idx) => {
      expect(args.body.indices).toEqual([idx]);
      expect(args.body.speechIds).toEqual([`sp-${10 + idx}`]);
      expect(args.body.speeches).toHaveLength(1);
    });

    expect(enqueuePromptsMock).toHaveBeenCalledTimes(1);
    const queuedPayload = enqueuePromptsMock.mock.calls[0][0] as {
      items: Array<{ url: string; meta?: any }>;
      queueUrl: string;
    };
    expect(queuedPayload.queueUrl).toBe('https://queue.example.com');
    expect(queuedPayload.items).toHaveLength(3);

    const expectedTotals = [70, 60, 65];
    queuedPayload.items.forEach((item, idx) => {
      expect(item.url).toBe(`s3://politopics-prompts/prompts/MTG-456_${idx}.json`);
      expect(item.meta).toBeDefined();
      const meta = item.meta as {
        indices: number[];
        speech_ids: string[];
        totalLen: number;
        range: { from: string; until: string };
        runId: string;
        startedAt: string;
      };
      expect(meta.indices).toEqual([idx]);
      expect(meta.speech_ids).toEqual([`sp-${10 + idx}`]);
      expect(meta.totalLen).toBe(expectedTotals[idx]);
      expect(meta.range).toEqual({ from: '2025-09-19', until: '2025-09-19' });
      expect(meta.runId).toBe('');
      expect(Number.isNaN(Date.parse(meta.startedAt))).toBe(false);
    });
  });

  test('skips when no speeches are present', async () => {
    fetchNationalDietRecordsMock.mockResolvedValue({
      meetingRecords: [
        {
          issueID: 'MTG-empty',
          speechRecord: [],
        },
      ],
    });

    const event: APIGatewayProxyEventV2 = {
      ...defaultEvent,
      headers: { 'x-api-key': 'secret' },
      queryStringParameters: { from: '2025-09-19', until: '2025-09-19' },
    };

    const response = await handler(event as any, {} as any, () => undefined);

    expect(response.statusCode).toBe(200);
    expect(putJsonS3Mock).not.toHaveBeenCalled();
    expect(enqueuePromptsMock).not.toHaveBeenCalled();
  });
});