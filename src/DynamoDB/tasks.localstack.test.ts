import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import type { IssueTask } from './tasks';
import { TaskRepository } from './tasks';

const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_URL;
const AWS_REGION = process.env.AWS_REGION || 'ap-northeast-3';

const createIssueTask = (args: { issueID: string; chunkCount: number }): IssueTask => {
  const createdAt = new Date().toISOString();
  return {
    pk: args.issueID,
    status: 'pending',
    llm: 'gemini',
    llmModel: 'gemini-2.5-pro',
    retryAttempts: 0,
    createdAt,
    updatedAt: createdAt,
    processingMode: args.chunkCount ? 'chunked' : 'direct',
    prompt_url: `s3://politopics/prompts/${args.issueID}_reduce.json`,
    meeting: {
      issueID: args.issueID,
      nameOfMeeting: 'Test Meeting',
      nameOfHouse: 'House',
      date: '2025-11-30',
      numberOfSpeeches: args.chunkCount || 1,
    },
    result_url: `s3://politopics/results/${args.issueID}_reduce.json`,
    chunks: Array.from({ length: args.chunkCount }, (_, idx) => ({
      id: `CHUNK#${idx}`,
      prompt_key: `prompts/${args.issueID}_${idx}.json`,
      prompt_url: `s3://politopics/prompts/${args.issueID}_${idx}.json`,
      result_url: `s3://politopics/results/${args.issueID}_${idx}.json`,
      status: 'notReady' as const,
    })),
  };
};

if (!LOCALSTACK_ENDPOINT) {
  // eslint-disable-next-line jest/no-focused-tests
  describe.skip('TaskRepository LocalStack integration', () => {
    it('skipped because LOCALSTACK_URL is not set', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('TaskRepository LocalStack integration', () => {
    const tableName = `politopics-llm-tasks-test-${Date.now()}`;
    let client: DynamoDBClient;
    let docClient: DynamoDBDocumentClient;
    let repository: TaskRepository;

    beforeAll(async () => {
      client = new DynamoDBClient({
        region: AWS_REGION,
        endpoint: LOCALSTACK_ENDPOINT,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
        },
      });
      docClient = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
      await client.send(new CreateTableCommand({
        TableName: tableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'pk', AttributeType: 'S' },
          { AttributeName: 'status', AttributeType: 'S' },
          { AttributeName: 'createdAt', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
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

      await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: tableName });
      repository = new TaskRepository({ tableName, client: docClient });
    }, 20000);

    afterAll(async () => {
      await client.send(new DeleteTableCommand({ TableName: tableName }));
      await client.destroy();
    });

    test('creates tasks with chunk metadata and lists pending items', async () => {
      const issueID = 'TEST-ISSUE';
      await repository.createTask(createIssueTask({ issueID, chunkCount: 2 }));

      const pending = await repository.getNextPending(5);
      expect(pending.some((task) => task.pk === issueID)).toBe(true);

      const stored = await repository.getTask(issueID);
      expect(stored?.chunks.length).toBe(2);
      expect(stored?.chunks.every((chunk) => chunk.status === 'notReady')).toBe(true);
    }, 20000);

    test('markChunkReady updates chunk status', async () => {
      const issueID = 'TEST-CHUNK';
      await repository.createTask(createIssueTask({ issueID, chunkCount: 1 }));

      await repository.markChunkReady(issueID, 'CHUNK#0');
      const updated = await repository.getTask(issueID);
      expect(updated?.chunks[0].status).toBe('ready');
      expect(updated?.status).toBe('pending');
    }, 20000);

    test('markTaskSucceeded updates status', async () => {
      const issueID = 'TEST-SUCCEED';
      await repository.createTask(createIssueTask({ issueID, chunkCount: 0 }));

      const result = await repository.markTaskSucceeded(issueID);
      expect(result?.status).toBe('succeeded');
    }, 20000);
  });
}
