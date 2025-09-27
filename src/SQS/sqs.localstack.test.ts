import {
  CreateQueueCommand,
  DeleteMessageBatchCommand,
  DeleteQueueCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

import { enqueuePromptsWithS3Batch, type PromptTaskMessage } from './sqs';

const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_URL || process.env.AWS_ENDPOINT_URL || 'http://127.0.0.1:4566';

describe('enqueuePromptsWithS3Batch (LocalStack)', () => {
  const ORIGINAL_ENV = process.env;
  const queueName = `politopics-test-${Date.now()}`;

  let queueUrl: string | undefined;
  let sqs: SQSClient | undefined;

  beforeAll(async () => {
    process.env = { ...ORIGINAL_ENV };
    process.env.AWS_REGION = process.env.AWS_REGION || 'ap-northeast-3';
    process.env.AWS_ENDPOINT_URL = LOCALSTACK_ENDPOINT;

    sqs = new SQSClient({ region: process.env.AWS_REGION, endpoint: LOCALSTACK_ENDPOINT });

    try {
      const { QueueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: queueName }));
      queueUrl = QueueUrl;
      process.env.PROMPT_QUEUE_URL = queueUrl;

      try {
        await sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
      } catch (purgeErr: any) {
        if (purgeErr?.name !== 'PurgeQueueInProgress' && purgeErr?.Code !== 'PurgeQueueInProgress') {
          throw purgeErr;
        }
      }
    } catch (err: any) {
      console.warn('Skipping LocalStack SQS integration test:', err?.message || err);
      queueUrl = undefined;
    }
  }, 15000);

  afterAll(async () => {
    if (queueUrl && sqs) {
      await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
    }
    process.env = ORIGINAL_ENV;
  });

  test('publishes batches that can be read from SQS', async () => {
    if (!queueUrl || !sqs) {
      return; // LocalStack not available; test skipped at runtime.
    }

    const items: PromptTaskMessage[] = [
      {
        type: 'chunk',
        url: 's3://politopics-prompts/a.json',
        llm: 'gemini',
        llmModel: 'gemini-2.5-pro',
        meta: { chunk: 1 },
      },
      {
        type: 'chunk',
        url: 's3://politopics-prompts/b.json',
        llm: 'gemini',
        llmModel: 'gemini-2.5-pro',
        meta: { chunk: 2 },
      },
    ];

    const result = await enqueuePromptsWithS3Batch({ items, queueUrl });
    expect(result.queued).toBe(items.length);

    const received = new Map<string, { body: any; receiptHandle: string }>();
    for (let attempt = 0; attempt < 8 && received.size < items.length; attempt += 1) {
      const res = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
        VisibilityTimeout: 0,
      }));

      for (const message of res.Messages || []) {
        if (message.Body && message.ReceiptHandle && message.MessageId) {
          if (received.has(message.MessageId)) {
            continue;
          }
          console.log('[LocalStack SQS] message body:', message.Body);
          received.set(message.MessageId, {
            body: JSON.parse(message.Body),
            receiptHandle: message.ReceiptHandle,
          });
        }
      }
    }

    expect(received.size).toBe(items.length);

    const bodies = Array.from(received.values()).map((entry) => entry.body);
    expect(bodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'chunk',
          url: 's3://politopics-prompts/a.json',
          llm: 'gemini',
          llmModel: 'gemini-2.5-pro',
          meta: expect.objectContaining({ chunk: 1 }),
        }),
        expect.objectContaining({
          type: 'chunk',
          url: 's3://politopics-prompts/b.json',
          llm: 'gemini',
          llmModel: 'gemini-2.5-pro',
          meta: expect.objectContaining({ chunk: 2 }),
        }),
      ]),
    );

    const deletes = Array.from(received.values()).map((entry, index) => ({
      Id: `d${index}`,
      ReceiptHandle: entry.receiptHandle,
    }));

    if (deletes.length) {
      await sqs.send(new DeleteMessageBatchCommand({ QueueUrl: queueUrl, Entries: deletes }));
    }
  }, 20000);
});
