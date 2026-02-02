// End-to-end-ish suite: mocks the National Diet API but drives the real Lambda handler against
// LocalStack S3 + DynamoDB to verify raw payload ingestion and task writes.
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import type { RawMeetingData, RawSpeechRecord } from '@NationalDietAPI/Raw';

import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
  waitUntilTableNotExists,
  type KeySchemaElement,
  type TableDescription,
} from '@aws-sdk/client-dynamodb';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  S3Client,
  type BucketLocationConstraint,
} from '@aws-sdk/client-s3';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

import { applyLambdaTestEnv, applyLocalstackEnv, getLocalstackConfig, DEFAULT_PROMPT_BUCKET, DEFAULT_LLM_TASK_TABLE } from './testUtils/testEnv';
import { appConfig } from './config';

/*
 * processes a small meeting and stores an ingested task in LocalStack
 * [Contract] Meetings must create an ingested task with raw payload and Dynamo entry and return 200.
 * [Reason] Ingestion must persist raw payloads so Recap can build prompts later.
 * [Accident] Without this, meetings could be dropped silently and never summarized.
 * [Odd] Two speeches to keep the payload tiny; pre-clears existing pk.
 * [History] None recorded; guardrail.
 *
 * processes mocked meetings and persists ingested tasks to LocalStack
 * [Contract] Larger mocked meetings must persist raw payloads and ingested tasks in LocalStack.
 * [Reason] Ingestion must scale regardless of meeting size.
 * [Accident] Without this, large meetings could fail ingestion and never reach Recap.
 * [Odd] Six speeches to emulate a larger payload.
 * [History] None; preventive.
 */

const buildSpeeches = (count: number): RawSpeechRecord[] => (
  Array.from({ length: count }, (_, idx) => ({
    speechID: `sp-${idx + 1}`,
    speechOrder: idx + 1,
    speaker: `Speaker ${idx + 1}`,
    speakerYomi: `Speaker ${idx + 1} Yomi`,
    speakerGroup: `Group ${idx + 1}`,
    speakerPosition: 'Member',
    speakerRole: `Role ${idx + 1}`,
    speech: `Speech text ${idx + 1}`,
    startPage: idx + 1,
    createTime: new Date().toISOString(),
    updateTime: new Date().toISOString(),
    speechURL: `https://example.com/sp-${idx + 1}`,
  }))
);

const { endpoint: LOCALSTACK_ENDPOINT } = getLocalstackConfig();

describe('lambda_handler mocked ND API with LocalStack DynamoDB', () => {
    const ORIGINAL_ENV = process.env;
    let bucketName = DEFAULT_PROMPT_BUCKET;
    let tableName = DEFAULT_LLM_TASK_TABLE;
    const cleanupInsertedTasks = false;

    const EXPECTED_PRIMARY_KEY: KeySchemaElement[] = [{ AttributeName: 'pk', KeyType: 'HASH' }];
    const EXPECTED_STATUS_INDEX_KEY: KeySchemaElement[] = [
      { AttributeName: 'status', KeyType: 'HASH' },
      { AttributeName: 'createdAt', KeyType: 'RANGE' },
    ];

    const schemaMatches = (actual: KeySchemaElement[] | undefined, expected: KeySchemaElement[]): boolean => (
      Boolean(actual) &&
      actual!.length === expected.length &&
      expected.every((expKey) => actual!.some((key) => key.AttributeName === expKey.AttributeName && key.KeyType === expKey.KeyType))
    );

    const tableMatchesExpectedSchema = (table?: TableDescription): boolean => {
      if (!table || !schemaMatches(table.KeySchema, EXPECTED_PRIMARY_KEY)) {
        return false;
      }
      const statusIndex = (table.GlobalSecondaryIndexes || []).find((index) => index.IndexName === 'StatusIndex');
      return Boolean(statusIndex && schemaMatches(statusIndex.KeySchema, EXPECTED_STATUS_INDEX_KEY));
    };

    let dynamo: DynamoDBClient;
    let docClient: DynamoDBDocumentClient;
    let s3: S3Client;
    let tableCreatedByTest = false;
    const insertedTasks: string[] = [];

    async function ensureTasksTable(): Promise<void> {
      try {
        const describe = await dynamo.send(new DescribeTableCommand({ TableName: tableName }));
        if (tableMatchesExpectedSchema(describe.Table)) {
          return;
        }
        console.warn(`[LocalStack Lambda Test] Table ${tableName} schema mismatch; recreating.`);
        await dynamo.send(new DeleteTableCommand({ TableName: tableName }));
        await waitUntilTableNotExists({ client: dynamo, maxWaitTime: 60 }, { TableName: tableName });
      } catch (error: any) {
        if (error?.name !== 'ResourceNotFoundException') {
          throw error;
        }
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
      tableCreatedByTest = true;
    }

    async function ensurePromptBucket(): Promise<void> {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
        return;
      } catch (error: any) {
        if (!['NotFound', 'NoSuchBucket'].includes(error?.name)) {
          // LocalStack reports 404 via Metadata httpStatusCode
          if (error?.$metadata?.httpStatusCode !== 404) {
            throw error;
          }
        }
      }

      const bucketRegion = 'ap-northeast-3';
      const configuration = { LocationConstraint: bucketRegion as BucketLocationConstraint };

      await s3.send(new CreateBucketCommand({
        Bucket: bucketName,
        ...(configuration ? { CreateBucketConfiguration: configuration } : {}),
      }));
    }

    beforeAll(async () => {
    // 1. Initialize S3 / DynamoDB clients pointing to LocalStack
    s3 = new S3Client({
      region: appConfig.aws.region,
      endpoint: appConfig.aws.endpoint,
      forcePathStyle: appConfig.aws.forcePathStyle,
      credentials: appConfig.aws.credentials,
    });
    dynamo = new DynamoDBClient({
      region: appConfig.aws.region,
      endpoint: appConfig.aws.endpoint,
      credentials: appConfig.aws.credentials,
    });
    docClient = DynamoDBDocumentClient.from(dynamo);

    bucketName = appConfig.promptBucket;
    tableName = appConfig.llmTaskTable;

    // We assume the bucket and table are already created by Terraform/LocalStack initialization script.
    // Ensure the table is empty or in a clean state if needed, or just proceed.
    // For now, we assume the environment is ready.
  });

    beforeEach(() => {
      jest.resetModules();
      jest.clearAllMocks();
    });

    afterAll(async () => {
      if (cleanupInsertedTasks && insertedTasks.length) {
        for (const pk of insertedTasks) {
          try {
            await docClient.send(new DeleteCommand({ TableName: tableName, Key: { pk } }));
          } catch (error) {
            console.warn('[LocalStack Lambda Test] Failed to delete task:', pk, error);
          }
        }
      } else if (insertedTasks.length) {
        console.log('[LocalStack Lambda Test] Left inserted tasks for inspection:', insertedTasks);
      }

      await Promise.allSettled([
        dynamo.destroy(),
        s3.destroy(),
      ]);
      process.env = ORIGINAL_ENV;
    });

    async function deleteTaskIfExists(pk: string): Promise<void> {
      try {
        await docClient.send(new DeleteCommand({ TableName: tableName, Key: { pk } }));
      } catch (error: any) {
        if (error?.name !== 'ResourceNotFoundException') {
          console.warn('[LocalStack Lambda Test] Failed to delete existing task (safe to ignore):', pk, error);
        }
      }
    }

    async function readObjectText(bucket: string, key: string): Promise<string> {
      const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = response.Body;
      if (!body) throw new Error(`Missing body for s3://${bucket}/${key}`);
      const chunks: Buffer[] = [];
      for await (const chunk of body as any) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString('utf8');
    }

    /*
     Contract: for small meetings the handler must ingest raw payloads and create task records.
     Reason: ingestion-only flow should not drop small meetings.
     Accident without this: tiny meetings could be skipped silently, reducing coverage.
     Odd values: tiny speech set keeps the payload small.
     Bug history: none recorded.
    */
    test('processes a small meeting and stores an ingested task in LocalStack', async () => {
      const issueID = `MTG-LOCAL-DIRECT-${Date.now()}`;
      const dietResponse: RawMeetingData = {
        numberOfRecords: 1,
        numberOfReturn: 1,
        startRecord: 1,
        nextRecordPosition: 0,
        meetingRecord: [
          {
            issueID,
            imageKind: 'text',
            searchObject: 0,
            session: 208,
            nameOfHouse: 'House of Representatives',
            nameOfMeeting: 'Budget Committee',
            issue: 'Budget Deliberations',
            date: '2024-09-24',
            closing: 'Adjourned',
            speechRecord: buildSpeeches(2),
          },
        ],
      };

      const fetchMock = jest.spyOn(global, 'fetch' as any).mockImplementation(async () => ({
        ok: true,
        statusText: 'OK',
        json: async () => dietResponse,
      } as Response));

      await deleteTaskIfExists(issueID);

      const event: APIGatewayProxyEventV2 = {
        version: '2.0',
        routeKey: '$default',
        rawPath: '/run',
        rawQueryString: 'from=2024-09-01&until=2024-09-30',
        queryStringParameters: {
          from: '2024-09-01',
          until: '2024-09-30',
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
        const { applyLambdaTestEnv, applyLocalstackEnv, DEFAULT_PROMPT_BUCKET, DEFAULT_LLM_TASK_TABLE } = await import('./testUtils/testEnv');
        applyLambdaTestEnv({
          NATIONAL_DIET_API_ENDPOINT: 'https://mock.ndl.go.jp/api/meeting',
          PROMPT_BUCKET: DEFAULT_PROMPT_BUCKET,
          LLM_TASK_TABLE: DEFAULT_LLM_TASK_TABLE,
        });
        applyLocalstackEnv();
        const { handler } = await import('./lambda_handler');
        const response = await handler(event, {} as any, () => undefined);
        expect(response.statusCode).toBe(200);
      });

      insertedTasks.push(issueID);
      const stored = await docClient.send(new GetCommand({ TableName: tableName, Key: { pk: issueID } }));
      expect(stored.Item).toBeDefined();
      expect(stored.Item?.status).toBe('ingested');
      expect(typeof stored.Item?.raw_url).toBe('string');
      expect(stored.Item?.prompt_url).toBeUndefined();

      const rawUrl = stored.Item?.raw_url as string;
      const [, rawBucket, rawKey] = rawUrl.match(/^s3:\/\/([^/]+)\/(.+)$/) ?? [];
      const rawText = await readObjectText(rawBucket, rawKey);
      const rawPayload = JSON.parse(rawText);
      expect(rawPayload?.meeting?.issueID).toBe(issueID);
      expect(Array.isArray(rawPayload?.meeting?.speechRecord)).toBe(true);

      fetchMock.mockRestore();
    }, 60000);

    /*
     Contract: ensures multi-speech meetings are ingested with raw payloads and task records.
     Reason: ingestion-only flow must persist raw payloads for Recap to chunk later.
     Accident without this: raw payload writes or DynamoDB records could be missing, stalling Recap.
     Odd values: mock meeting count ensures multi-speech payloads are handled.
     Bug history: none.
    */
    test('processes mocked meetings and persists ingested tasks to LocalStack', async () => {
      const issueID = `MTG-LOCAL-CHUNK-${Date.now()}`;
      const dietResponse: RawMeetingData = {
        numberOfRecords: 1,
        numberOfReturn: 1,
        startRecord: 1,
        nextRecordPosition: 0,
        meetingRecord: [
          {
            issueID,
            imageKind: 'text',
            searchObject: 0,
            session: 208,
            nameOfHouse: 'House of Representatives',
            nameOfMeeting: 'Science Committee',
            issue: 'AI Policy',
            date: '2024-10-01',
            closing: 'Adjourned',
            speechRecord: buildSpeeches(6),
          },
        ],
      };

      const fetchMock = jest.spyOn(global, 'fetch' as any).mockImplementation(async () => ({
        ok: true,
        statusText: 'OK',
        json: async () => dietResponse,
      } as Response));

      await deleteTaskIfExists(issueID);

      const event: APIGatewayProxyEventV2 = {
        version: '2.0',
        routeKey: '$default',
        rawPath: '/run',
        rawQueryString: 'from=2024-10-01&until=2024-10-31',
        queryStringParameters: {
          from: '2024-10-01',
          until: '2024-10-31',
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
        const { applyLambdaTestEnv, applyLocalstackEnv, DEFAULT_PROMPT_BUCKET, DEFAULT_LLM_TASK_TABLE } = await import('./testUtils/testEnv');
        applyLambdaTestEnv({
          NATIONAL_DIET_API_ENDPOINT: 'https://mock.ndl.go.jp/api/meeting',
          PROMPT_BUCKET: DEFAULT_PROMPT_BUCKET,
          LLM_TASK_TABLE: DEFAULT_LLM_TASK_TABLE,
        });
        applyLocalstackEnv();
        const { handler } = await import('./lambda_handler');
        const response = await handler(event, {} as any, () => undefined);

        expect(response.statusCode).toBe(200);
      });

      insertedTasks.push(issueID);
      const stored = await docClient.send(new GetCommand({ TableName: tableName, Key: { pk: issueID } }));
      expect(stored.Item).toBeDefined();
      expect(stored.Item?.status).toBe('ingested');
      expect(typeof stored.Item?.raw_url).toBe('string');
      expect(stored.Item?.prompt_url).toBeUndefined();

      const rawUrl = stored.Item?.raw_url as string;
      const [, rawBucket, rawKey] = rawUrl.match(/^s3:\/\/([^/]+)\/(.+)$/) ?? [];
      const rawText = await readObjectText(rawBucket, rawKey);
      const rawPayload = JSON.parse(rawText);
      expect(rawPayload?.meeting?.issueID).toBe(issueID);
      expect(Array.isArray(rawPayload?.meeting?.speechRecord)).toBe(true);

      fetchMock.mockRestore();
    }, 60000);
  });
