import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
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
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import type { RawSpeechRecord } from '@NationalDietAPI/Raw';

import { installMockGeminiCountTokens } from './testUtils/mockApis';

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

const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_URL;

if (!LOCALSTACK_ENDPOINT) {
  // eslint-disable-next-line jest/no-focused-tests
  describe.skip('lambda_handler duplicate issueID guard (LocalStack)', () => {
    it('skipped because LOCALSTACK_URL is not set', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('lambda_handler duplicate issueID guard (LocalStack)', () => {
    const ORIGINAL_ENV = process.env;
    const bucketName = process.env.PROMPT_BUCKET || 'politopics-prompts';
    const tableName = process.env.LLM_TASK_TABLE || 'PoliTopics-llm-tasks';
    const cleanupInsertedTasks = process.env.CLEANUP_DUPLICATE_TEST_TASKS === '1';

    const EXPECTED_PRIMARY_KEY: KeySchemaElement[] = [{ AttributeName: 'pk', KeyType: 'HASH' }];
    const EXPECTED_STATUS_INDEX_KEY: KeySchemaElement[] = [
      { AttributeName: 'status', KeyType: 'HASH' },
      { AttributeName: 'createdAt', KeyType: 'RANGE' },
    ];

    let dynamo: DynamoDBClient;
    let docClient: DynamoDBDocumentClient;
    let s3: S3Client;
    const insertedTasks: string[] = [];
    let bucketCreatedByTest = false;
    let tableCreatedByTest = false;

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

    async function ensureBucket(): Promise<void> {
      try {
        await s3.send(new CreateBucketCommand({
          Bucket: bucketName,
        }));
        bucketCreatedByTest = true;
      } catch (error: any) {
        if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(error?.name)) {
          throw error;
        }
      }
    }

    async function emptyBucket(): Promise<void> {
      try {
        const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucketName }));
        for (const item of listed.Contents || []) {
          if (item.Key) {
            await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: item.Key }));
          }
        }
      } catch (error) {
        console.warn('[DuplicateIssueTest] Failed to clean up bucket objects:', error);
      }
    }

    async function ensureTasksTable(): Promise<void> {
      try {
        const describe = await dynamo.send(new DescribeTableCommand({ TableName: tableName }));
        if (tableMatchesExpectedSchema(describe.Table)) {
          return;
        }
        console.warn(`[DuplicateIssueTest] Table ${tableName} schema mismatch; recreating.`);
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

      process.env.NATIONAL_DIET_API_ENDPOINT = 'https://mock.ndl.go.jp/api/meeting';
      process.env.GEMINI_MAX_INPUT_TOKEN = '200';
      process.env.GEMINI_API_KEY = 'fake-key';
      process.env.RUN_API_KEY = 'secret';
      process.env.PROMPT_BUCKET = bucketName;
      process.env.LOCALSTACK_URL = LOCALSTACK_ENDPOINT;
      process.env.AWS_ENDPOINT_URL = LOCALSTACK_ENDPOINT;
      process.env.AWS_REGION = process.env.AWS_REGION || 'ap-northeast-3';
      process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test';
      process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test';
      process.env.LLM_TASK_TABLE = tableName;

      s3 = new S3Client({
        region: process.env.AWS_REGION,
        endpoint: LOCALSTACK_ENDPOINT,
        forcePathStyle: true,
      });

      dynamo = new DynamoDBClient({
        region: process.env.AWS_REGION,
        endpoint: LOCALSTACK_ENDPOINT,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
      });
      docClient = DynamoDBDocumentClient.from(dynamo, { marshallOptions: { removeUndefinedValues: true } });

      await ensureBucket();
      await ensureTasksTable();
    }, 40000);

    afterAll(async () => {
      if (cleanupInsertedTasks && insertedTasks.length) {
        for (const pk of insertedTasks) {
          try {
            await docClient.send(new DeleteCommand({ TableName: tableName, Key: { pk } }));
          } catch (error) {
            console.warn('[DuplicateIssueTest] Failed to delete task during cleanup:', pk, error);
          }
        }
      } else if (insertedTasks.length) {
        console.log('[DuplicateIssueTest] Left inserted tasks for inspection:', insertedTasks);
      }

      if (bucketCreatedByTest) {
        await emptyBucket();
        try {
          await s3.send(new DeleteBucketCommand({ Bucket: bucketName }));
        } catch (error) {
          console.warn('[DuplicateIssueTest] Failed to delete bucket:', error);
        }
      }
      if (tableCreatedByTest) {
        await dynamo.send(new DeleteTableCommand({ TableName: tableName }));
        await waitUntilTableNotExists({ client: dynamo, maxWaitTime: 60 }, { TableName: tableName });
      }

      await dynamo.destroy();
      await s3.destroy();
      process.env = ORIGINAL_ENV;
    });

    test(
      'skips creation when issueID already exists in LocalStack DynamoDB',
      async () => {
        const issueID = `MTG-DUP-${Date.now()}`;
        const createdAt = new Date().toISOString();
        const seededTask = {
          pk: issueID,
          status: 'pending',
          llm: 'gemini',
          llmModel: 'gemini-2.5-pro',
          retryAttempts: 0,
          createdAt,
          updatedAt: createdAt,
          processingMode: 'single_chunk' as const,
          prompt_url: `s3://${bucketName}/prompts/${issueID}_reduce.json`,
          meeting: {
            issueID,
            nameOfMeeting: 'Budget Committee',
            nameOfHouse: 'House of Representatives',
            date: '2024-09-24',
            numberOfSpeeches: 2,
            session: 208,
          },
          result_url: `s3://${bucketName}/results/${issueID}_reduce.json`,
          chunks: [],
        };
        await docClient.send(new PutCommand({ TableName: tableName, Item: seededTask }));
        insertedTasks.push(issueID);

        const dietResponse = {
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

        const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
          ok: true,
          statusText: 'OK',
          json: async () => dietResponse,
        } as Response);

        installMockGeminiCountTokens(10);

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

        const stored = await docClient.send(new GetCommand({ TableName: tableName, Key: { pk: issueID } }));
        expect(stored.Item?.updatedAt).toBe(createdAt);

        fetchMock.mockRestore();
      },
      60000,
    );
  });
}
