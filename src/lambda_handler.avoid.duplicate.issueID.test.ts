// Regression suite for duplicate issueID handling: runs the Lambda against LocalStack S3/DynamoDB
// to ensure pre-existing tasks short-circuit and do not enqueue duplicate work.
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

import {
  S3Client,
} from '@aws-sdk/client-s3';
import {
  DescribeTableCommand,
  DynamoDBClient,
  type KeySchemaElement,
  type TableDescription,
} from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

import type { RawSpeechRecord } from '@NationalDietAPI/Raw';

import { applyLambdaTestEnv, applyLocalstackEnv, getLocalstackConfig, DEFAULT_PROMPT_BUCKET, DEFAULT_LLM_TASK_TABLE } from './testUtils/testEnv';
import { appConfig } from './config';

/*
 * skips creation when issueID already exists in LocalStack DynamoDB
 * [Contract] Handler must short-circuit and avoid writing duplicates if a task with the same issueID already exists.
 * [Reason] Idempotency is required for reruns/replays to prevent duplicate work.
 * [Accident] Without this, repeated runs would enqueue duplicates and double processing.
 * [Odd] Pre-seeds Dynamo with a pending pk `MTG-DUP-...` and reruns handler with mocked ND API.
 * [History] Regression cover for prior duplicate-task behavior in LocalStack runs (no ticket).
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

describe('lambda_handler duplicate issueID guard (LocalStack)', () => {
    const ORIGINAL_ENV = process.env;
    const bucketName = DEFAULT_PROMPT_BUCKET;
    let tableName = DEFAULT_LLM_TASK_TABLE;
    const cleanupInsertedTasks = false;

    const EXPECTED_PRIMARY_KEY: KeySchemaElement[] = [{ AttributeName: 'pk', KeyType: 'HASH' }];
    const EXPECTED_STATUS_INDEX_KEY: KeySchemaElement[] = [
      { AttributeName: 'status', KeyType: 'HASH' },
      { AttributeName: 'createdAt', KeyType: 'RANGE' },
    ];

    let dynamo: DynamoDBClient;
    let docClient: DynamoDBDocumentClient;
    let s3: S3Client;
    const insertedTasks: string[] = [];

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

    beforeAll(async () => {
      jest.resetModules();
      jest.clearAllMocks();
      process.env = { ...ORIGINAL_ENV };

      applyLambdaTestEnv({
        NATIONAL_DIET_API_ENDPOINT: 'https://mock.ndl.go.jp/api/meeting',
        PROMPT_BUCKET: bucketName,
        LLM_TASK_TABLE: tableName,
      });
      applyLocalstackEnv();
      tableName = appConfig.llmTaskTable;

      const awsRegion = appConfig.aws.region;
      const credentials = appConfig.aws.credentials ?? {
        accessKeyId: 'test',
        secretAccessKey: 'test',
      };

      s3 = new S3Client({
        region: awsRegion,
        endpoint: LOCALSTACK_ENDPOINT,
        forcePathStyle: true,
        credentials,
      });

      dynamo = new DynamoDBClient({
        region: awsRegion,
        endpoint: LOCALSTACK_ENDPOINT,
        credentials,
      });
      docClient = DynamoDBDocumentClient.from(dynamo, { marshallOptions: { removeUndefinedValues: true } });
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

      await dynamo.destroy();
      await s3.destroy();
      process.env = ORIGINAL_ENV;
    });

    /*
     Contract: if a task already exists for an issueID, the handler must short-circuit and avoid writing duplicates; failure means idempotency guard is broken.
     Reason: operational rule—reruns should not enqueue duplicate work for the same meeting.
     Accident without this: repeated runs could spam DynamoDB and trigger duplicate processing downstream.
     Odd values: pre-seeding DynamoDB with an existing pk simulates replay conditions.
     Bug history: regression test for prior duplicate task writes in LocalStack runs (no tracked ticket).
    */
    test(
      'skips creation when issueID already exists in LocalStack DynamoDB',
      async () => {
        const issueID = `MTG-DUP-${Date.now()}`;
        const createdAt = new Date().toISOString();
        const seededTask = {
          pk: issueID,
          status: 'ingested',
          retryAttempts: 0,
          createdAt,
          updatedAt: createdAt,
          raw_url: `s3://${bucketName}/raw/${issueID}.json`,
          raw_hash: 'seed',
          meeting: {
            issueID,
            nameOfMeeting: 'Budget Committee',
            nameOfHouse: 'House of Representatives',
            date: '2024-09-24',
            numberOfSpeeches: 2,
            session: 208,
          },
          attachedAssets: {
            speakerMetadataUrl: `s3://${bucketName}/attachedAssets/${issueID}.json`,
          },
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

        const stored = await docClient.send(new GetCommand({ TableName: tableName, Key: { pk: issueID } }));
        expect(stored.Item?.createdAt).toBe(createdAt);
        const updatedAt = new Date(stored.Item?.updatedAt as string).getTime();
        expect(stored.Item?.status).toBe('ingested');

        fetchMock.mockRestore();
      },
      60000,
    );
  });
