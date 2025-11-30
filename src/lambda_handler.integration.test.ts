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
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
  waitUntilTableNotExists,
} from '@aws-sdk/client-dynamodb';
import type { KeySchemaElement, TableDescription } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { installMockGeminiCountTokens } from './testUtils/mockApis';

const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_URL;

if (!LOCALSTACK_ENDPOINT) {
  // eslint-disable-next-line jest/no-focused-tests
  describe.skip('lambda_handler integration using LocalStack', () => {
    it('skipped because LOCALSTACK_URL is not set', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('lambda_handler integration using the real National Diet API with LocalStack S3/DynamoDB', () => {
    const ORIGINAL_ENV = process.env;
    const bucketName = 'politopics-prompts';
    const configuredTable = process.env.LLM_TASK_TABLE;
    const tableName = configuredTable || 'PoliTopics-llm-tasks';
    const cleanupCreatedTable = process.env.CLEANUP_LOCALSTACK_TASK_TABLE === '1';
    const cleanupCreatedBucket = process.env.CLEANUP_LOCALSTACK_BUCKET === '1';

    let s3: S3Client | undefined;
    let dynamo: DynamoDBClient | undefined;
    let docClient: DynamoDBDocumentClient | undefined;
    let bucketCreatedByTest = false;
    let tableCreatedByTest = false;

    const cacheFile = path.join(os.tmpdir(), 'nd-cache.json');
    const artifactsDir = path.join(process.cwd(), 'localstack-artifacts');

    const EXPECTED_PRIMARY_KEY: KeySchemaElement[] = [
      { AttributeName: 'pk', KeyType: 'HASH' },
    ];
    const EXPECTED_STATUS_INDEX_KEY: KeySchemaElement[] = [
      { AttributeName: 'status', KeyType: 'HASH' },
      { AttributeName: 'createdAt', KeyType: 'RANGE' },
    ];

    function keySchemaMatches(actual: KeySchemaElement[] | undefined, expected: KeySchemaElement[]): boolean {
      if (!actual || actual.length !== expected.length) {
        return false;
      }
      return expected.every((expectedKey) => (
        actual.some((key) => key.AttributeName === expectedKey.AttributeName && key.KeyType === expectedKey.KeyType)
      ));
    }

    function tableMatchesExpectedSchema(table?: TableDescription): boolean {
      if (!table) {
        return false;
      }
      if (!keySchemaMatches(table.KeySchema, EXPECTED_PRIMARY_KEY)) {
        return false;
      }
      const statusIndex = (table.GlobalSecondaryIndexes || []).find((index) => index.IndexName === 'StatusIndex');
      if (!statusIndex) {
        return false;
      }
      return keySchemaMatches(statusIndex.KeySchema, EXPECTED_STATUS_INDEX_KEY);
    }

    async function createTasksTable(): Promise<void> {
      if (!dynamo) {
        return;
      }
      await dynamo.send(new CreateTableCommand({
        TableName: tableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'pk', AttributeType: 'S' },
          { AttributeName: 'status', AttributeType: 'S' },
          { AttributeName: 'createdAt', AttributeType: 'S' },
        ],
        KeySchema: EXPECTED_PRIMARY_KEY,
        GlobalSecondaryIndexes: [
          {
            IndexName: 'StatusIndex',
            KeySchema: EXPECTED_STATUS_INDEX_KEY,
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      }));
      await waitUntilTableExists({ client: dynamo, maxWaitTime: 60 }, { TableName: tableName });
    }

    async function ensureTasksTable(): Promise<void> {
      if (!dynamo) {
        return;
      }
      try {
        const describe = await dynamo.send(new DescribeTableCommand({ TableName: tableName }));
        if (!tableMatchesExpectedSchema(describe.Table)) {
          console.warn(`[LocalStack Integration] Table ${tableName} schema mismatch; recreating for integration test.`);
          await dynamo.send(new DeleteTableCommand({ TableName: tableName }));
          await waitUntilTableNotExists({ client: dynamo, maxWaitTime: 60 }, { TableName: tableName });
          await createTasksTable();
          tableCreatedByTest = true;
        }
      } catch (error: any) {
        if (error?.name !== 'ResourceNotFoundException') {
          throw error;
        }
        await createTasksTable();
        tableCreatedByTest = true;
      }
    }

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

    async function deleteTable(): Promise<void> {
      if (!dynamo) {
        return;
      }
      try {
        await dynamo.send(new DeleteTableCommand({ TableName: tableName }));
        await waitUntilTableNotExists({ client: dynamo, maxWaitTime: 60 }, { TableName: tableName });
      } catch (error) {
        console.warn('Failed to delete LocalStack DynamoDB table:', error);
      } finally {
        await dynamo.destroy();
      }
    }

    async function fetchAllTasks(): Promise<any[]> {
      if (!docClient) {
        return [];
      }
      const res = await docClient.send(new ScanCommand({ TableName: tableName }));
      return res.Items || [];
    }

    async function deleteAllTasks(): Promise<void> {
      if (!docClient) {
        return;
      }
      try {
        const existing = await docClient.send(new ScanCommand({ TableName: tableName, ProjectionExpression: 'pk' }));
        const items = existing.Items || [];
        if (!items.length) {
          return;
        }
        for (let i = 0; i < items.length; i += 25) {
          const batch = items.slice(i, i + 25).map((item) => ({ DeleteRequest: { Key: { pk: item.pk } } }));
          await docClient.send(new BatchWriteCommand({
            RequestItems: {
              [tableName]: batch,
            },
          }));
        }
      } catch (error) {
        console.warn('Failed to delete existing LocalStack tasks:', error);
      }
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
      process.env.LLM_TASK_TABLE = tableName;

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
        bucketCreatedByTest = true;
      } catch (error: any) {
        if (error?.name !== 'BucketAlreadyOwnedByYou') {
          throw error;
        }
      }

      dynamo = new DynamoDBClient({
        region: process.env.AWS_REGION,
        endpoint: LOCALSTACK_ENDPOINT,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
        },
      });
      docClient = DynamoDBDocumentClient.from(dynamo, { marshallOptions: { removeUndefinedValues: true } });

      console.log(`[LocalStack Integration] Using DynamoDB table: ${tableName}`);
      await ensureTasksTable();
    }, 40000);

    afterAll(async () => {
      if (tableCreatedByTest) {
        if (cleanupCreatedTable) {
          await deleteTable();
        } else {
          console.log(`[LocalStack Integration] Leaving created DynamoDB table ${tableName} for manual inspection.`);
          await dynamo?.destroy();
        }
      } else {
        await dynamo?.destroy();
        console.log(`[LocalStack Integration] DynamoDB table ${tableName} existed prior to test; left untouched.`);
      }

      if (bucketCreatedByTest && cleanupCreatedBucket) {
        await emptyAndDeleteBucket();
      } else if (bucketCreatedByTest) {
        console.log(`[LocalStack Integration] Leaving created S3 bucket ${bucketName} intact for review.`);
      }

      delete process.env.NATIONAL_DIET_CACHE_FILE;
      delete process.env.AWS_ENDPOINT_URL;
      delete process.env.LLM_TASK_TABLE;

      process.env = ORIGINAL_ENV;
    });

    test(
      'fetches from the real API, caches the response, and stores DynamoDB tasks',
      async () => {
        const fetchSpy = jest.spyOn(globalThis, 'fetch');
        installMockGeminiCountTokens(10);

        const hadCacheAtStart = existsSync(cacheFile);
        const runTimestamp = Date.now();

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

        await deleteAllTasks();

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

          const tasksAfterFirst = await fetchAllTasks();
          const recentTasks = tasksAfterFirst.filter((task) => {
            const created = Date.parse(task.createdAt || '');
            return Number.isFinite(created) && created >= runTimestamp;
          });
      if (!recentTasks.length) {
            console.warn('No newly created DynamoDB tasks found; ensure LocalStack is running and ND range returns data.');
          }

          expect(recentTasks.length).toBeGreaterThan(0);
          expect(recentTasks.every((task) => typeof task.prompt_url === 'string' && task.prompt_url.startsWith(`s3://${bucketName}/prompts/`))).toBe(true);

          const chunkedTasks = recentTasks.filter((task) => task.processingMode === 'chunked');
          const directTasks = recentTasks.filter((task) => task.processingMode === 'direct');

          if (chunkedTasks.length) {
            expect(chunkedTasks.every((task) =>
              Array.isArray(task.chunks) &&
              task.chunks.length > 0 &&
              task.chunks.every((chunk: any) => chunk.status === 'notReady')
            )).toBe(true);
          }
          if (directTasks.length) {
            expect(directTasks.every((task) => Array.isArray(task.chunks) && task.chunks.length === 0)).toBe(true);
          }

          const fetchCallsAfterFirst = fetchSpy.mock.calls.length;

          fetchSpy.mockImplementation(() => {
            throw new Error('Fetch should not be called when cache is populated');
          });

          const secondResponse = await handler(event, {} as any, () => undefined);
          console.log('secondResponse:', secondResponse);
          expect(secondResponse.statusCode).toBe(200);
          expect(fetchSpy.mock.calls.length).toBe(fetchCallsAfterFirst);

          const tasksAfterSecond = await fetchAllTasks();
          expect(tasksAfterSecond.length).toBeGreaterThan(0);
          expect(tasksAfterSecond.every((task) => typeof task.prompt_url === 'string' && task.prompt_url.startsWith(`s3://${bucketName}/prompts/`))).toBe(true);
          expect(tasksAfterSecond.every((task) => Array.isArray(task.chunks))).toBe(true);

          try {
            mkdirSync(artifactsDir, { recursive: true });
            const artifactPath = path.join(artifactsDir, `dynamodb-tasks-${Date.now()}.json`);
            writeFileSync(artifactPath, JSON.stringify(tasksAfterSecond, null, 2), 'utf8');
            console.log(`[LocalStack Integration] Saved DynamoDB tasks to ${artifactPath}`);
          } catch (error) {
            console.warn('Failed to persist DynamoDB tasks snapshot:', error);
          }

          const pendingStatuses = tasksAfterSecond.filter((task) => task.status === 'pending');
          expect(pendingStatuses.length).toBe(tasksAfterSecond.length);
        });
      },
      60000,
    );
  });
}
