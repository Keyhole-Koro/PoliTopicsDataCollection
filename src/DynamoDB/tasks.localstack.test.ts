import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

import type { MapTaskItem, ReduceTaskItem } from './tasks';
import { TaskRepository } from './tasks';

const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_URL;
const AWS_REGION = process.env.AWS_REGION || 'ap-northeast-3';

const createMapTask = (args: { issueID: string; index: number; createdAt: string }): MapTaskItem => ({
  pk: args.issueID,
  sk: `MAP#${args.index}` as const,
  type: 'map',
  status: 'pending',
  llm: 'gemini',
  llmModel: 'gemini-2.5-pro',
  retryAttempts: 0,
  createdAt: args.createdAt,
  updatedAt: args.createdAt,
  url: `s3://politopics/prompts/${args.issueID}_${args.index}.json`,
  result_url: `s3://politopics/results/${args.issueID}_${args.index}.json`,
});

const createReduceTask = (args: { issueID: string; createdAt: string; chunkUrls: string[] }): ReduceTaskItem => ({
  pk: args.issueID,
  sk: 'REDUCE',
  type: 'reduce',
  status: 'pending',
  llm: 'gemini',
  llmModel: 'gemini-2.5-pro',
  retryAttempts: 0,
  createdAt: args.createdAt,
  updatedAt: args.createdAt,
  chunk_result_urls: args.chunkUrls,
  prompt: 'Reduce prompt',
  meeting: {
    issueID: args.issueID,
    nameOfMeeting: 'Test Meeting',
    nameOfHouse: 'House',
    date: '2025-11-30',
    numberOfSpeeches: 2,
  },
  result_url: `s3://politopics/results/${args.issueID}_reduce.json`,
});

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

      await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName: tableName });
      repository = new TaskRepository({ tableName, client: docClient });
    }, 20000);

    afterAll(async () => {
      await client.send(new DeleteTableCommand({ TableName: tableName }));
      await client.destroy();
    });

    test('stores map tasks and enqueues reduce once all maps succeed', async () => {
      const issueID = 'TEST-ISSUE';
      const createdAt = new Date().toISOString();
      const maps: MapTaskItem[] = [
        createMapTask({ issueID, index: 0, createdAt }),
        createMapTask({ issueID, index: 1, createdAt }),
      ];

      await repository.putMapTasks(maps);

      const pending = await repository.getNextPending(5);
      expect(pending.some((task) => task.pk === issueID && task.status === 'pending')).toBe(true);

      await repository.markTaskSucceeded(issueID, 'MAP#0');
      let createdReduce = await repository.ensureReduceWhenMapsDone({
        issueID,
        reduce: createReduceTask({ issueID, createdAt, chunkUrls: maps.map((m) => m.result_url) }),
      });
      expect(createdReduce).toBe(false);

      await repository.markTaskSucceeded(issueID, 'MAP#1');
      createdReduce = await repository.ensureReduceWhenMapsDone({
        issueID,
        reduce: createReduceTask({ issueID, createdAt, chunkUrls: maps.map((m) => m.result_url) }),
      });
      expect(createdReduce).toBe(true);

      const results = await docClient.send(new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': issueID },
      }));

      const reduce = results.Items?.find((item) => item.sk === 'REDUCE');
      expect(reduce).toBeDefined();
      expect(reduce?.status).toBe('pending');
    }, 30000);
  });
}
