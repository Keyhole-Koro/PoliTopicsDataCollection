/**
 * Unit tests for SQS enqueue helper. We mock the AWS SDK module so no network calls happen.
 */

jest.mock('@aws-sdk/client-sqs', () => {
  const sendMock = jest.fn().mockResolvedValue({ ok: true });
  const SQSClient = jest.fn().mockImplementation(() => ({ send: sendMock }));
  const SendMessageCommand = jest.fn().mockImplementation((args) => ({ args }));
  const SendMessageBatchCommand = jest.fn().mockImplementation((args) => ({ args }));
  return { SQSClient, SendMessageCommand, SendMessageBatchCommand, __mocks: { sendMock } };
}, { virtual: true });

import { enqueuePromptsWithS3Batch } from './sqs';

const { __mocks } = jest.requireMock('@aws-sdk/client-sqs');

describe('enqueuePromptsWithS3Batch', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    __mocks.sendMock.mockClear();
  });
  afterEach(() => { process.env = OLD_ENV; });

  test('returns no-op when queue URL is missing', async () => {
    delete process.env.PROMPT_QUEUE_URL;
    delete process.env.CHUNK_QUEUE_URL;
    const res = await enqueuePromptsWithS3Batch({ items: [] });
    expect(res).toEqual({ queued: 0, urls: [] });
    expect(__mocks.sendMock).not.toHaveBeenCalled();
  });

  test('sends batches of at most 10 messages', async () => {
    process.env.PROMPT_QUEUE_URL = 'https://sqs.local/prompts';
    const items = Array.from({ length: 12 }, (_, idx) => ({
      type: 'prompt' as const,
      url: `s3://bucket/key-${idx}`,
      llm: 'gemini',
      llmModel: 'gemini-2.5-pro',
      meta: { idx },
    }));

    const res = await enqueuePromptsWithS3Batch({ items });

    expect(res.queued).toBe(12);
    expect(res.urls).toHaveLength(12);
    expect(__mocks.sendMock).toHaveBeenCalledTimes(2);

    const firstCall = __mocks.sendMock.mock.calls[0][0];
    const secondCall = __mocks.sendMock.mock.calls[1][0];
    expect(firstCall.args.Entries).toHaveLength(10);
    expect(secondCall.args.Entries).toHaveLength(2);
  });

  test('converts delayMs to DelaySeconds', async () => {
    process.env.PROMPT_QUEUE_URL = 'https://sqs.local/prompts';
    const res = await enqueuePromptsWithS3Batch({
      items: [{
        type: 'prompt',
        url: 's3://bucket/key',
        llm: 'gemini',
        llmModel: 'gemini-2.5-pro',
        delayMs: 1500,
      }],
    });

    expect(res.queued).toBe(1);
    const call = __mocks.sendMock.mock.calls[0][0];
    expect(call.args.Entries[0].DelaySeconds).toBe(2);
  });

  test('rejects payloads with missing required fields', async () => {
    process.env.PROMPT_QUEUE_URL = 'https://sqs.local/prompts';

    await expect(enqueuePromptsWithS3Batch({
      items: [{
        type: 'prompt',
        // url missing on purpose
        llm: 'gemini',
        llmModel: 'gemini-2.5-pro',
      } as any],
    })).rejects.toThrow('url must be a non-empty string');

    expect(__mocks.sendMock).not.toHaveBeenCalled();
  });

  test('rejects payloads with invalid delayMs', async () => {
    process.env.PROMPT_QUEUE_URL = 'https://sqs.local/prompts';

    await expect(enqueuePromptsWithS3Batch({
      items: [{
        type: 'prompt',
        url: 's3://bucket/key',
        llm: 'gemini',
        llmModel: 'gemini-2.5-pro',
        delayMs: -10,
      }],
    })).rejects.toThrow('delayMs, when provided, must be a finite number >= 0');

    expect(__mocks.sendMock).not.toHaveBeenCalled();
  });
});