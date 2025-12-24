// TaskRepository integration tests exercising the real DynamoDB API via LocalStack (create/query/update flows).
import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

import type { IssueTask } from './tasks';
import { TaskRepository } from './tasks';
import { applyLocalstackEnv, getLocalstackConfig, DEFAULT_PROMPT_BUCKET } from '../testUtils/testEnv';
import { appConfig } from '../config';

const { endpoint: LOCALSTACK_ENDPOINT, configured: HAS_LOCALSTACK } = getLocalstackConfig();

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
    processingMode: args.chunkCount ? 'chunked' : 'single_chunk',
    prompt_url: `s3://${DEFAULT_PROMPT_BUCKET}/prompts/${args.issueID}_reduce.json`,
    meeting: {
      issueID: args.issueID,
      nameOfMeeting: 'Test Meeting',
      nameOfHouse: 'House',
      date: '2025-11-30',
      numberOfSpeeches: args.chunkCount || 1,
      session: 208,
    },
    result_url: `s3://${DEFAULT_PROMPT_BUCKET}/results/${args.issueID}_reduce.json`,
    chunks: Array.from({ length: args.chunkCount }, (_, idx) => ({
      id: `CHUNK#${idx}`,
      prompt_key: `prompts/${args.issueID}_${idx}.json`,
      prompt_url: `s3://${DEFAULT_PROMPT_BUCKET}/prompts/${args.issueID}_${idx}.json`,
      result_url: `s3://${DEFAULT_PROMPT_BUCKET}/results/${args.issueID}_${idx}.json`,
      status: 'notReady' as const,
    })),
  };
};

if (!HAS_LOCALSTACK) {
  // eslint-disable-next-line jest/no-focused-tests
  describe.skip('TaskRepository LocalStack integration', () => {
    it('skipped because LOCALSTACK_URL is not set', () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe('TaskRepository LocalStack integration', () => {
    const ORIGINAL_ENV = process.env;
    let tableName: string;
    let client: DynamoDBClient;
    let docClient: DynamoDBDocumentClient;
    let repository: TaskRepository;
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
      client = new DynamoDBClient({
        region: awsRegion,
        endpoint: LOCALSTACK_ENDPOINT,
        credentials,
      });
      docClient = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
      
      repository = new TaskRepository({ tableName, client: docClient });
    }, 20000);

    afterAll(async () => {
      await client.destroy();
      process.env = ORIGINAL_ENV;
    });

    test('creates tasks with chunk metadata and lists pending items', async () => {
      const issueID = `TEST-ISSUE-${Date.now()}`;
      await repository.createTask(createIssueTask({ issueID, chunkCount: 2 }));

      const pending = await repository.getNextPending(5);
      expect(pending.every((task) => task.status === "pending")).toBe(true);

      const stored = await repository.getTask(issueID);
      expect(stored?.chunks.length).toBe(2);
      expect(stored?.chunks.every((chunk) => chunk.status === 'notReady')).toBe(true);
    }, 20000);

    test('markChunkReady updates chunk status', async () => {
      const issueID = `TEST-CHUNK-${Date.now()}`;
      await repository.createTask(createIssueTask({ issueID, chunkCount: 1 }));

      await repository.markChunkReady(issueID, 'CHUNK#0');
      const updated = await repository.getTask(issueID);
      expect(updated?.chunks[0].status).toBe('ready');
      expect(updated?.status).toBe('pending');
    }, 20000);

    test('markTaskSucceeded updates status', async () => {
      const issueID = `TEST-SUCCEED-${Date.now()}`;
      await repository.createTask(createIssueTask({ issueID, chunkCount: 0 }));

      const result = await repository.markTaskSucceeded(issueID);
      expect(result?.status).toBe('completed');
    }, 20000);
  });
}
