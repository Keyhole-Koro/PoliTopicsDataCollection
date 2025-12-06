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
import { DeleteCommand, DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

import { installMockGeminiCountTokens } from './testUtils/mockApis';

const buildSpeeches = (count: number): RawSpeechRecord[] => (
  Array.from({ length: count }, (_, idx) => ({
    speechID: `sp-${idx + 1}`,
    speechOrder: idx + 1,
    speaker: `Speaker ${idx + 1}`,
    speakerYomi: null,
    speakerGroup: null,
    speakerPosition: null,
    speakerRole: null,
    speech: `Speech text ${idx + 1}`,
    startPage: idx + 1,
    createTime: new Date().toISOString(),
    updateTime: new Date().toISOString(),
    speechURL: `https://example.com/sp-${idx + 1}`,
  }))
);

const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_URL;

if (!LOCALSTACK_ENDPOINT) {
  // eslint-disable-next-line jest/no-focused-tests
  describe.skip('lambda_handler mocked ND API with LocalStack S3/DynamoDB', () => {
    it('skipped because LOCALSTACK_URL is not set', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('lambda_handler mocked ND API with LocalStack DynamoDB', () => {
    const ORIGINAL_ENV = process.env;
    const bucketName = process.env.PROMPT_BUCKET || 'politopics-prompts';
    const configuredTable = process.env.LLM_TASK_TABLE;
    const tableName = configuredTable || 'PoliTopics-llm-tasks';
    const cleanupInsertedTasks = process.env.CLEANUP_LOCALSTACK_LAMBDA_TASKS === '1';

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

    beforeAll(async () => {
      jest.resetModules();
      jest.clearAllMocks();
      process.env = { ...ORIGINAL_ENV };

      process.env.NATIONAL_DIET_CACHE_FILE = '';
      process.env.NATIONAL_DIET_API_ENDPOINT = 'https://mock.ndl.go.jp/api/meeting';
      process.env.GEMINI_MAX_INPUT_TOKEN = '100';
      process.env.GEMINI_API_KEY = 'fake-key';
      process.env.RUN_API_KEY = 'secret';
      process.env.PROMPT_BUCKET = bucketName;
      process.env.LOCALSTACK_URL = LOCALSTACK_ENDPOINT;
      process.env.AWS_ENDPOINT_URL = LOCALSTACK_ENDPOINT;
      process.env.AWS_REGION = process.env.AWS_REGION || 'ap-northeast-3';
      process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test';
      process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test';
      process.env.LLM_TASK_TABLE = tableName;

      dynamo = new DynamoDBClient({
        region: process.env.AWS_REGION,
        endpoint: LOCALSTACK_ENDPOINT,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      });

      docClient = DynamoDBDocumentClient.from(dynamo, { marshallOptions: { removeUndefinedValues: true } });

      await ensureTasksTable();
    }, 40000);

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

      if (tableCreatedByTest && process.env.CLEANUP_LOCALSTACK_LAMBDA_TABLE === '1') {
        await dynamo.send(new DeleteTableCommand({ TableName: tableName }));
        await waitUntilTableNotExists({ client: dynamo, maxWaitTime: 60 }, { TableName: tableName });
      }

      await dynamo.destroy();
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

    test('processes a small meeting and stores a direct task in LocalStack', async () => {
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
            closing: null,
            speechRecord: buildSpeeches(2),
          },
        ],
      };

      const fetchMock = jest.spyOn(global, 'fetch' as any).mockImplementation(async () => ({
        ok: true,
        statusText: 'OK',
        json: async () => dietResponse,
      } as Response));

      process.env.GEMINI_MAX_INPUT_TOKEN = '120';
      installMockGeminiCountTokens(10);

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
        const { handler } = await import('./lambda_handler');
        const response = await handler(event, {} as any, () => undefined);
        expect(response.statusCode).toBe(200);
      });

      insertedTasks.push(issueID);
      const stored = await docClient.send(new GetCommand({ TableName: tableName, Key: { pk: issueID } }));
      expect(stored.Item).toBeDefined();
      expect(stored.Item?.processingMode).toBe('direct');
      expect(Array.isArray(stored.Item?.chunks)).toBe(true);
      expect(stored.Item?.chunks?.length ?? 0).toBe(0);
      expect(typeof stored.Item?.prompt_url).toBe('string');

      fetchMock.mockRestore();
    }, 60000);

    test('processes mocked meetings and persists chunked tasks to LocalStack', async () => {
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
            closing: null,
            speechRecord: buildSpeeches(6),
          },
        ],
      };

      const fetchMock = jest.spyOn(global, 'fetch' as any).mockImplementation(async () => ({
        ok: true,
        statusText: 'OK',
        json: async () => dietResponse,
      } as Response));

      process.env.GEMINI_MAX_INPUT_TOKEN = '35';
      installMockGeminiCountTokens(10);

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
        const { handler } = await import('./lambda_handler');
        const response = await handler(event, {} as any, () => undefined);

        expect(response.statusCode).toBe(200);
      });

      insertedTasks.push(issueID);
      const stored = await docClient.send(new GetCommand({ TableName: tableName, Key: { pk: issueID } }));
      expect(stored.Item).toBeDefined();
      expect(stored.Item?.processingMode).toBe('chunked');
      expect(Array.isArray(stored.Item?.chunks)).toBe(true);
      expect(stored.Item?.chunks?.length).toBeGreaterThan(0);
      expect(stored.Item?.chunks?.every((chunk: any) => chunk.status === 'notReady' || chunk.status === 'ready')).toBe(true);
      expect(typeof stored.Item?.prompt_url).toBe('string');

      fetchMock.mockRestore();
    }, 60000);
  });
}
