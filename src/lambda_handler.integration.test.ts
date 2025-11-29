import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type BucketLocationConstraint,
  type CreateBucketCommandInput,
} from '@aws-sdk/client-s3';
import {
  CreateQueueCommand,
  DeleteMessageBatchCommand,
  DeleteQueueCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { installMockGeminiCountTokens } from './testUtils/mockApis';

describe('lambda_handler integration using the real National Diet API with LocalStack S3/SQS', () => {
  const ORIGINAL_ENV = process.env;
  const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_URL;
  if (!LOCALSTACK_ENDPOINT) {
    throw new Error('LOCALSTACK_URL must be set to run the integration test.');
  }
  const bucketName = 'politopics-prompts';
  const queueName = `politopics-integration-${Date.now()}`;

  let s3: S3Client | undefined;
  let sqs: SQSClient | undefined;
  let queueUrl: string | undefined;

  const cacheFile = path.join(os.tmpdir(), 'nd-cache.json');
  const artifactsDir = path.join(process.cwd(), 'localstack-artifacts');

  async function emptyAndDeleteBucket(): Promise<void> {
    if (!s3) {
      return;
    }
    try {
      const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucketName }));
      for (const item of listed.Contents || []) {
        if (item.Key) {
          await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: item.Key }));
        }
      }
      await s3.send(new DeleteBucketCommand({ Bucket: bucketName }));
    } catch (error) {
      console.warn('Failed to clean up S3 bucket:', error);
    }
  }

  async function drainQueueMessages(): Promise<any[]> {
    if (!sqs || !queueUrl) {
      return [];
    }
    const messages: any[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const res = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 1,
          VisibilityTimeout: 0,
        }),
      );
      if (!res.Messages?.length) {
        break;
      }
      for (const message of res.Messages) {
        if (message.Body && message.ReceiptHandle && message.MessageId) {
          messages.push({
            body: JSON.parse(message.Body),
            receiptHandle: message.ReceiptHandle,
          });
        }
      }
    }
    if (messages.length) {
      const entries = messages.map((m, idx) => ({
        Id: `msg-${idx}`,
        ReceiptHandle: m.receiptHandle,
      }));
      for (let i = 0; i < entries.length; i += 10) {
        const batch = entries.slice(i, i + 10);
        await sqs.send(new DeleteMessageBatchCommand({ QueueUrl: queueUrl, Entries: batch }));
      }
    }
    return messages.map((m) => m.body);
  }

  beforeAll(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };

    process.env.NATIONAL_DIET_CACHE_FILE = cacheFile;
    process.env.NATIONAL_DIET_API_ENDPOINT = 'https://kokkai.ndl.go.jp/api/meeting';
    process.env.GEMINI_MAX_INPUT_TOKEN = '12000';
    process.env.GEMINI_API_KEY = 'fake-key';
    process.env.RUN_API_KEY = 'secret';
    process.env.LOCALSTACK_URL = LOCALSTACK_ENDPOINT;
    process.env.AWS_ENDPOINT_URL = LOCALSTACK_ENDPOINT;
    process.env.AWS_REGION = process.env.AWS_REGION || 'ap-northeast-3';
    process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test';
    process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test';

    const region = (process.env.AWS_REGION || 'ap-northeast-3') as BucketLocationConstraint;

    s3 = new S3Client({
      region,
      endpoint: LOCALSTACK_ENDPOINT,
      forcePathStyle: true,
    });

    try {
      const createBucketInput: CreateBucketCommandInput = {
        Bucket: bucketName,
        CreateBucketConfiguration: { LocationConstraint: region },
      };
      await s3.send(new CreateBucketCommand(createBucketInput));
    } catch (error: any) {
      if (error?.name !== 'BucketAlreadyOwnedByYou') {
        throw error;
      }
    }

    sqs = new SQSClient({
      region: process.env.AWS_REGION,
      endpoint: LOCALSTACK_ENDPOINT,
    });

    const { QueueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: queueName }));
    if (!QueueUrl) {
      throw new Error('Failed to create LocalStack SQS queue');
    }
    queueUrl = QueueUrl;
    process.env.PROMPT_QUEUE_URL = queueUrl;

    try {
      await sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
    } catch (error: any) {
      if (error?.name !== 'PurgeQueueInProgress' && error?.Code !== 'PurgeQueueInProgress') {
        throw error;
      }
    }
  }, 30000);

  afterAll(async () => {
    if (queueUrl && sqs) {
      try {
        await sqs.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
      } catch (error) {
        console.warn('Failed to delete LocalStack queue:', error);
      }
    }
    await emptyAndDeleteBucket();

    delete process.env.NATIONAL_DIET_CACHE_FILE;
    delete process.env.PROMPT_QUEUE_URL;
    delete process.env.AWS_ENDPOINT_URL;

    process.env = ORIGINAL_ENV;
  });

  test(
    'fetches from the real API, caches the response, and enqueues SQS messages',
    async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch');
      installMockGeminiCountTokens(10);

      const hadCacheAtStart = existsSync(cacheFile);

      const from = process.env.ND_TEST_FROM ?? '2025-09-01';
      const until = process.env.ND_TEST_UNTIL ?? '2025-09-30';

      const event: APIGatewayProxyEventV2 = {
        version: '2.0',
        routeKey: '$default',
        rawPath: '/run',
        rawQueryString: `from=${from}&until=${until}`,
        queryStringParameters: {
          from,
          until,
        },
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

        const firstResponse = await handler(event, {} as any, () => undefined);
        console.log('firstResponse:', firstResponse);
        expect(firstResponse.statusCode).toBe(200);

        const firstFetchCalls = fetchSpy.mock.calls.length;

        if (!hadCacheAtStart) {
          expect(firstFetchCalls).toBeGreaterThan(0);
          expect(existsSync(cacheFile)).toBe(true);
        } else {
          expect(firstFetchCalls).toBe(0);
        }

        const firstMessages = await drainQueueMessages();
        if (!firstMessages.length) {
          console.warn('No SQS messages received; ensure LocalStack is running and ND range returns data.');
        }

        const fetchCallsAfterFirst = fetchSpy.mock.calls.length;

        fetchSpy.mockImplementation(() => {
          throw new Error('Fetch should not be called when cache is populated');
        });

        const secondResponse = await handler(event, {} as any, () => undefined);
        console.log('secondResponse:', secondResponse);
        expect(secondResponse.statusCode).toBe(200);
        expect(fetchSpy.mock.calls.length).toBe(fetchCallsAfterFirst);

        const secondMessages = await drainQueueMessages();

        const combined = [...firstMessages, ...secondMessages];
        const mapMessages = combined.filter((msg) => msg.type === 'map');
        const reduceMessages = combined.filter((msg) => msg.type === 'reduce');

        try {
          mkdirSync(artifactsDir, { recursive: true });
          const artifactPath = path.join(artifactsDir, `sqs-messages-${Date.now()}.json`);
          writeFileSync(artifactPath, JSON.stringify(combined, null, 2), 'utf8');
          console.log(`[LocalStack Integration] Saved SQS messages to ${artifactPath}`);
        } catch (error) {
          console.warn('Failed to persist SQS messages snapshot:', error);
        }

        if (combined.length) {
          expect(mapMessages.length).toBeGreaterThan(0);
          expect(reduceMessages.length).toBeGreaterThan(0);
        }
      });
    },
    60000,
  );
});
