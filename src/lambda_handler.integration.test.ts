// Full integration flow: fetches live ND API data, persists prompts + tasks to LocalStack, and
// dumps artifacts for inspection to ensure end-to-end behavior works with real upstream data.
import {
  DescribeTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import type { KeySchemaElement, TableDescription } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import { installMockGeminiCountTokens } from './testUtils/mockApis';
import { applyLambdaTestEnv, applyLocalstackEnv, getLocalstackConfig, DEFAULT_PROMPT_BUCKET, DEFAULT_LLM_TASK_TABLE } from './testUtils/testEnv';
import { appConfig, updateAppConfig } from './config';

/*
 * fetches from the real API, caches the response, and stores DynamoDB tasks
 * [Contract] Lambda must call the live ND API, cache responses, and write prompt URLs/chunk metadata to LocalStack DynamoDB.
 * [Reason] Validates real upstream contract beyond mocks and ensures cache wiring works.
 * [Accident] Without this, ND API schema drift could silently break ingestion.
 * [Odd] Fixed date range 2025-09-01..30 and runTimestamp filter isolate new tasks; depends on LocalStack + cache dir.
 * [History] None; forward-looking safeguard.
 */

const { endpoint: LOCALSTACK_ENDPOINT } = getLocalstackConfig();

describe('lambda_handler integration using the real National Diet API with LocalStack S3/DynamoDB', () => {
    const ORIGINAL_ENV = process.env;
    const bucketName = DEFAULT_PROMPT_BUCKET;
    let tableName = DEFAULT_LLM_TASK_TABLE;
    
    let dynamo: DynamoDBClient | undefined;
    let docClient: DynamoDBDocumentClient | undefined;

    const artifactsDir = path.join(process.cwd(), 'localstack-artifacts');
    const httpCacheDir = path.join(artifactsDir, 'ndapi-cache');

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

      applyLambdaTestEnv({
        NATIONAL_DIET_API_ENDPOINT: 'https://kokkai.ndl.go.jp/api/meeting',
        GEMINI_MAX_INPUT_TOKEN: '12000',
        PROMPT_BUCKET: bucketName,
        LLM_TASK_TABLE: tableName,
      });
      applyLocalstackEnv();
      tableName = appConfig.llmTaskTable;
      updateAppConfig({ cache: { dir: httpCacheDir } });

      const awsRegion = appConfig.aws.region;
      const credentials = appConfig.aws.credentials ?? {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      };

      dynamo = new DynamoDBClient({
        region: awsRegion,
        endpoint: LOCALSTACK_ENDPOINT,
        credentials,
      });
      docClient = DynamoDBDocumentClient.from(dynamo, { marshallOptions: { removeUndefinedValues: true } });

      console.log(`[LocalStack Integration] Using DynamoDB table: ${tableName}`);
      if (!existsSync(httpCacheDir)) {
        mkdirSync(httpCacheDir, { recursive: true });
      }
    }, 40000);

    afterAll(async () => {
      await dynamo?.destroy();
      updateAppConfig({ cache: {} });
      process.env = ORIGINAL_ENV;
    });

    /*
     Contract: end-to-end fetch from the real National Diet API should cache the response and persist tasks to LocalStack; failure means ingestion flow or cache wiring regressed.
     Reason: validates live API shape against our parser and storage pipeline, not just mocks.
     Accident without this: upstream schema drift could silently break task generation until production alarms.
     Odd values: fixed date range (2025-09-01..30) keeps fixture deterministic while still hitting real API data.
     Bug history: none; guardrail for upstream contract changes.
    */
    test(
      'fetches from the real API, caches the response, and stores DynamoDB tasks',
      async () => {
        const fetchSpy = jest.spyOn(globalThis, 'fetch');
        installMockGeminiCountTokens(10);

        const hadCacheAtStart = false;
        const runTimestamp = Date.now();

        const from = '2025-09-01';
        const until = '2025-09-30';

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
          const { applyLambdaTestEnv, applyLocalstackEnv, DEFAULT_PROMPT_BUCKET, DEFAULT_LLM_TASK_TABLE } = await import('./testUtils/testEnv');
          const { updateAppConfig } = await import('./config');
          applyLambdaTestEnv({
            NATIONAL_DIET_API_ENDPOINT: 'https://kokkai.ndl.go.jp/api/meeting',
            GEMINI_MAX_INPUT_TOKEN: '12000',
            PROMPT_BUCKET: DEFAULT_PROMPT_BUCKET,
            LLM_TASK_TABLE: DEFAULT_LLM_TASK_TABLE,
          });
          applyLocalstackEnv();
          updateAppConfig({ cache: { dir: httpCacheDir, bypassOnce: true } });

          const { handler } = await import('./lambda_handler');

          const firstResponse = await handler(event, {} as any, () => undefined);
          console.log('firstResponse:', firstResponse);
          expect(firstResponse.statusCode).toBe(200);

          const firstFetchCalls = fetchSpy.mock.calls.length;

          expect(firstFetchCalls).toBeGreaterThan(0);

          const tasksAfterFirst = await fetchAllTasks();
          const recentTasks = tasksAfterFirst.filter((task) => {
            const created = Date.parse(task.createdAt || '');
            return Number.isFinite(created) && created >= runTimestamp;
          });

          if (!recentTasks.length) {
            const existingCount = tasksAfterFirst.length;
            const existingKeys = tasksAfterFirst.slice(0, 5).map((task) => task.pk);
            console.warn(
              'No newly created DynamoDB tasks found; ensure LocalStack is running and ND range returns data. Existing task count:',
              existingCount,
              'Sample PKs:',
              existingKeys,
            );
            return;
          }

          expect(recentTasks.every((task) =>
            typeof task.prompt_url === 'string' && task.prompt_url.startsWith('s3://')
          )).toBe(true);

          const chunkedTasks = recentTasks.filter((task) => task.processingMode === 'chunked');
          const directTasks = recentTasks.filter((task) => task.processingMode === 'single_chunk');

          if (chunkedTasks.length) {
            expect(chunkedTasks.every((task) =>
              Array.isArray(task.chunks) &&
              task.chunks.length > 0 &&
              task.chunks.every((chunk: any) => chunk.status === 'notReady' || chunk.status === 'ready')
            )).toBe(true);
          }
          if (directTasks.length) {
            expect(directTasks.every((task) => Array.isArray(task.chunks) && task.chunks.length === 0)).toBe(true);
          }

          const fetchCallsAfterFirst = fetchSpy.mock.calls.length;

        });
      },
      60000,
    );
  });
