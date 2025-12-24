// Validates chunked-task lifecycle (create, chunk-ready updates, task completion) against LocalStack DynamoDB.
import {
  DescribeTableCommand,
  DynamoDBClient,
  type KeySchemaElement,
  type TableDescription,
} from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import type { IssueTask } from './tasks';
import { TaskRepository } from './tasks';
import { applyLocalstackEnv, getLocalstackConfig, DEFAULT_PROMPT_BUCKET } from '../testUtils/testEnv';
import { appConfig } from '../config';

const { endpoint: LOCALSTACK_ENDPOINT, configured: HAS_LOCALSTACK } = getLocalstackConfig();
let tableName = appConfig.llmTaskTable;
const CLEANUP_RECORDS = false;

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
    prompt_url: `s3://${DEFAULT_PROMPT_BUCKET}/prompts/${issueID}_reduce.json`,
    meeting: {
      issueID,
      nameOfMeeting: 'Chunk Test Meeting',
      nameOfHouse: 'House',
      date: '2025-11-30',
      numberOfSpeeches: chunkCount,
      session: 208,
    },
    result_url: `s3://${DEFAULT_PROMPT_BUCKET}/results/${issueID}_reduce.json`,
    chunks: Array.from({ length: chunkCount }, (_, idx) => ({
      id: `CHUNK#${idx}`,
      prompt_key: `prompts/${issueID}_${idx}.json`,
      prompt_url: `s3://${DEFAULT_PROMPT_BUCKET}/prompts/${issueID}_${idx}.json`,
      result_url: `s3://${DEFAULT_PROMPT_BUCKET}/results/${issueID}_${idx}.json`,
      status: 'notReady' as const,
    })),
  };
};

if (!HAS_LOCALSTACK) {
  // eslint-disable-next-line jest/no-focused-tests
  describe.skip('TaskRepository chunked LocalStack test', () => {
    it('skipped because LOCALSTACK_URL is not set', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('TaskRepository chunked LocalStack test', () => {
    const ORIGINAL_ENV = process.env;
    let dynamo: DynamoDBClient;
    let docClient: DynamoDBDocumentClient;
    let repository: TaskRepository;
    const insertedIssueIds: string[] = [];
    let awsRegion: string;

    beforeAll(async () => {
      process.env = { ...ORIGINAL_ENV };
      applyLocalstackEnv();
      tableName = appConfig.llmTaskTable;
      awsRegion = appConfig.aws.region;
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

      repository = new TaskRepository({ tableName, client: docClient });
      console.log(`[LocalStack Chunk Test] Using DynamoDB table ${tableName}`);
    }, 40000);

    afterAll(async () => {
      if (CLEANUP_RECORDS && insertedIssueIds.length) {
        for (const pk of insertedIssueIds) {
          try {
            await docClient.send(new DeleteCommand({ TableName: tableName, Key: { pk } }));
          } catch (error) {
            console.warn(`[LocalStack Chunk Test] Failed to delete ${pk}:`, error);
          }
        }
      } else if (insertedIssueIds.length) {
        console.log('[LocalStack Chunk Test] Left inserted tasks for inspection:', insertedIssueIds);
      }

      await dynamo.destroy();
      process.env = ORIGINAL_ENV;
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

      const chunkReady = await repository.markChunkReady(issueID, 'CHUNK#0');
      expect(chunkReady?.chunks[0].status).toBe('ready');

      const succeeded = await repository.markTaskSucceeded(issueID);
      expect(succeeded?.status).toBe('completed');

      console.log(`[LocalStack Chunk Test] Inserted task ${issueID} with ${chunkCount} chunks into ${tableName}.`);
    }, 30000);
  });
}
