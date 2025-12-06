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
import { DeleteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import type { IssueTask } from './tasks';
import { TaskRepository } from './tasks';

const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_URL;
const AWS_REGION = process.env.AWS_REGION || 'ap-northeast-3';
const TABLE_NAME = process.env.LLM_TASK_TABLE || 'PoliTopics-llm-tasks';
const CLEANUP_TABLE = process.env.CLEANUP_LOCALSTACK_CHUNK_TABLE === '1';
const CLEANUP_RECORDS = process.env.CLEANUP_LOCALSTACK_CHUNK_RECORDS === '1';

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

const createChunkedTask = (issueID: string, chunkCount: number): IssueTask => {
  const createdAt = new Date().toISOString();
  return {
    pk: issueID,
    status: 'pending',
    llm: 'gemini',
    llmModel: 'gemini-2.5-pro',
    retryAttempts: 0,
    createdAt,
    updatedAt: createdAt,
    processingMode: 'chunked',
    prompt_url: `s3://politopics-prompts/prompts/${issueID}_reduce.json`,
    meeting: {
      issueID,
      nameOfMeeting: 'Chunk Test Meeting',
      nameOfHouse: 'House',
      date: '2025-11-30',
      numberOfSpeeches: chunkCount,
    },
    result_url: `s3://politopics-prompts/results/${issueID}_reduce.json`,
    chunks: Array.from({ length: chunkCount }, (_, idx) => ({
      id: `CHUNK#${idx}`,
      prompt_key: `prompts/${issueID}_${idx}.json`,
      prompt_url: `s3://politopics-prompts/prompts/${issueID}_${idx}.json`,
      result_url: `s3://politopics-prompts/results/${issueID}_${idx}.json`,
      status: 'notReady' as const,
    })),
  };
};

async function ensureTasksTable(
  dynamo: DynamoDBClient,
  onCreate: () => void,
): Promise<void> {
  try {
    const describe = await dynamo.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    if (tableMatchesExpectedSchema(describe.Table)) {
      return;
    }
    console.warn(`[LocalStack Chunk Test] Table ${TABLE_NAME} schema mismatch; recreating.`);
    await dynamo.send(new DeleteTableCommand({ TableName: TABLE_NAME }));
    await waitUntilTableNotExists({ client: dynamo, maxWaitTime: 60 }, { TableName: TABLE_NAME });
  } catch (error: any) {
    if (error?.name !== 'ResourceNotFoundException') {
      throw error;
    }
  }

  await dynamo.send(new CreateTableCommand({
    TableName: TABLE_NAME,
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
  await waitUntilTableExists({ client: dynamo, maxWaitTime: 60 }, { TableName: TABLE_NAME });
  onCreate();
}

if (!LOCALSTACK_ENDPOINT) {
  // eslint-disable-next-line jest/no-focused-tests
  describe.skip('TaskRepository chunked LocalStack test', () => {
    it('skipped because LOCALSTACK_URL is not set', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('TaskRepository chunked LocalStack test', () => {
    let dynamo: DynamoDBClient;
    let docClient: DynamoDBDocumentClient;
    let repository: TaskRepository;
    const insertedIssueIds: string[] = [];
    let tableCreatedByTest = false;

    beforeAll(async () => {
      dynamo = new DynamoDBClient({
        region: AWS_REGION,
        endpoint: LOCALSTACK_ENDPOINT,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
        },
      });
      docClient = DynamoDBDocumentClient.from(dynamo, { marshallOptions: { removeUndefinedValues: true } });

      await ensureTasksTable(dynamo, () => { tableCreatedByTest = true; });
      repository = new TaskRepository({ tableName: TABLE_NAME, client: docClient });
      console.log(`[LocalStack Chunk Test] Using DynamoDB table ${TABLE_NAME}`);
    }, 40000);

    afterAll(async () => {
      if (CLEANUP_RECORDS && insertedIssueIds.length) {
        for (const pk of insertedIssueIds) {
          try {
            await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { pk } }));
          } catch (error) {
            console.warn(`[LocalStack Chunk Test] Failed to delete ${pk}:`, error);
          }
        }
      } else if (insertedIssueIds.length) {
        console.log('[LocalStack Chunk Test] Left inserted tasks for inspection:', insertedIssueIds);
      }

      if (tableCreatedByTest && CLEANUP_TABLE) {
        await dynamo.send(new DeleteTableCommand({ TableName: TABLE_NAME }));
        await waitUntilTableNotExists({ client: dynamo, maxWaitTime: 60 }, { TableName: TABLE_NAME });
      } else if (tableCreatedByTest) {
        console.log(`[LocalStack Chunk Test] Table ${TABLE_NAME} was created for this run and left intact.`);
      }

      await dynamo.destroy();
    });

    test('creates a chunked task in LocalStack DynamoDB', async () => {
      const issueID = `MOCK-CHUNK-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      insertedIssueIds.push(issueID);
      const chunkCount = 2;

      await repository.createTask(createChunkedTask(issueID, chunkCount));

      const stored = await repository.getTask(issueID);
      expect(stored?.pk).toBe(issueID);
      expect(stored?.chunks).toHaveLength(chunkCount);
      expect(stored?.chunks.every((chunk) => chunk.status === 'notReady')).toBe(true);

      await repository.markChunkReady(issueID, 'CHUNK#0');
      const chunkReady = await repository.getTask(issueID);
      expect(chunkReady?.chunks[0].status).toBe('ready');

      await repository.markTaskSucceeded(issueID);
    const succeeded = await repository.getTask(issueID);
    expect(succeeded?.status).toBe('completed');

      console.log(`[LocalStack Chunk Test] Inserted task ${issueID} with ${chunkCount} chunks into ${TABLE_NAME}.`);
    }, 30000);
  });
}
