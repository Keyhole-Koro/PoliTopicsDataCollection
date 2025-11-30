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
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
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

      try {
        await dynamo.send(new DescribeTableCommand({ TableName: tableName }));
      } catch (error: any) {
        if (error?.name !== 'ResourceNotFoundException') {
          throw error;
        }
        await dynamo.send(new CreateTableCommand({
          TableName: tableName,
          BillingMode: 'PAY_PER_REQUEST',
          AttributeDefinitions: [
            { AttributeName: 'pk', AttributeType: 'S' },
            { AttributeName: 'sk', AttributeType: 'S' },
            { AttributeName: 'status', AttributeType: 'S' },
            { AttributeName: 'createdAt', AttributeType: 'S' },
          ],
          KeySchema: [
            { AttributeName: 'pk', KeyType: 'HASH' },
            { AttributeName: 'sk', KeyType: 'RANGE' },
          ],
          GlobalSecondaryIndexes: [
            {
              IndexName: 'StatusIndex',
              KeySchema: [
                { AttributeName: 'status', KeyType: 'HASH' },
                { AttributeName: 'createdAt', KeyType: 'RANGE' },
              ],
              Projection: { ProjectionType: 'ALL' },
            },
          ],
        }));
        await waitUntilTableExists({ client: dynamo, maxWaitTime: 60 }, { TableName: tableName });
        tableCreatedByTest = true;
      }
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

          const recentMapTasks = recentTasks.filter((task) => task.type === 'map');
          const recentReduceTasks = recentTasks.filter((task) => task.type === 'reduce');
          expect(recentMapTasks.length).toBeGreaterThan(0);

          const mapIssueIDs = new Set(recentMapTasks.map((task) => task.pk));
          if (!recentReduceTasks.length) {
            const existingReduceForIssues = tasksAfterFirst.filter((task) => task.type === 'reduce' && mapIssueIDs.has(task.pk));
            if (!existingReduceForIssues.length) {
              console.warn('No reduce tasks found for newly created map issue IDs; they may not have been written yet.');
            }
            expect(existingReduceForIssues.length).toBeGreaterThan(0);
          } else {
            expect(recentReduceTasks.length).toBeGreaterThan(0);
          }
          expect(recentMapTasks.every((task) => typeof task.pk === 'string' && task.pk.length > 0)).toBe(true);
          expect(recentMapTasks.every((task) => typeof task.sk === 'string' && task.sk.startsWith('MAP#'))).toBe(true);
          expect(recentMapTasks.every((task) => typeof task.url === 'string' && task.url.startsWith(`s3://${bucketName}/prompts/`))).toBe(true);
          expect(recentMapTasks.every((task) => typeof task.result_url === 'string' && task.result_url.startsWith(`s3://${bucketName}/results/`))).toBe(true);
          expect(recentReduceTasks.every((task) => task.sk === 'REDUCE')).toBe(true);
          expect(recentReduceTasks.every((task) => Array.isArray(task.chunk_result_urls) && task.chunk_result_urls.length > 0)).toBe(true);

          const fetchCallsAfterFirst = fetchSpy.mock.calls.length;

          fetchSpy.mockImplementation(() => {
            throw new Error('Fetch should not be called when cache is populated');
          });

          const secondResponse = await handler(event, {} as any, () => undefined);
          console.log('secondResponse:', secondResponse);
          expect(secondResponse.statusCode).toBe(200);
          expect(fetchSpy.mock.calls.length).toBe(fetchCallsAfterFirst);

          const tasksAfterSecond = await fetchAllTasks();
          const mapTasks = tasksAfterSecond.filter((task) => task.type === 'map');
          const reduceTasks = tasksAfterSecond.filter((task) => task.type === 'reduce');
          expect(mapTasks.length).toBeGreaterThan(0);
          expect(reduceTasks.length).toBeGreaterThan(0);

          try {
            mkdirSync(artifactsDir, { recursive: true });
            const artifactPath = path.join(artifactsDir, `dynamodb-tasks-${Date.now()}.json`);
            writeFileSync(artifactPath, JSON.stringify(tasksAfterSecond, null, 2), 'utf8');
            console.log(`[LocalStack Integration] Saved DynamoDB tasks to ${artifactPath}`);
          } catch (error) {
            console.warn('Failed to persist DynamoDB tasks snapshot:', error);
          }

          const pendingStatuses = [...mapTasks, ...reduceTasks].filter((task) => task.status === 'pending');
          expect(pendingStatuses.length).toBe(mapTasks.length + reduceTasks.length);
        });
      },
      60000,
    );
  });
}
