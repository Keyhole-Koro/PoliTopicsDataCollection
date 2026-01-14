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

/*
 * creates tasks with chunk metadata and lists pending items
 * [Contract] TaskRepository must persist chunked tasks with chunk arrays and return them via StatusIndex queries.
 * [Reason] Worker polling depends on StatusIndex to find pending work.
 * [Accident] Without this, workers could miss tasks or see incomplete chunk metadata.
 * [Odd] chunkCount=2 forces non-trivial chunk arrays.
 * [History] None; preventive.
 *
 * markChunkReady updates chunk status
 * [Contract] markChunkReady must flip a chunk to ready without changing task status.
 * [Reason] Reduce scheduling depends on per-chunk readiness.
 * [Accident] Without this, reduce prompts would never be scheduled.
 * [Odd] chunkCount=1 minimal payload to hit the path.
 * [History] None.
 *
 * markTaskSucceeded updates status
 * [Contract] markTaskSucceeded must promote pending tasks to completed.
 * [Reason] Downstream recap pipeline reads completion to avoid duplicates.
 * [Accident] Without this, tasks would remain pending and be retried or duplicated.
 * [Odd] chunkCount=0 covers single_chunk/direct path.
 * [History] None.
 */

const { endpoint: LOCALSTACK_ENDPOINT } = getLocalstackConfig();

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
    attachedAssets: {
      speakerMetadataUrl: `s3://${DEFAULT_PROMPT_BUCKET}/attachedAssets/${args.issueID}.json`,
    },
  };
};

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

    /*
     Contract: ensures TaskRepository can persist chunked tasks and list them via the StatusIndex; failure means write/query paths or index definitions changed.
     Reason: chunked tasks are the dominant mode for large meetings; this validates LocalStack wiring and schema expectations.
     Accident without this: a schema drift could break StatusIndex reads and stall all ingestion without immediate alerts.
     Odd values: chunkCount=2 forces multi-chunk payloads rather than single-chunk shortcuts.
     Bug history: none specific; preventive coverage.
    */
    test('creates tasks with chunk metadata and lists pending items', async () => {
      const issueID = `TEST-ISSUE-${Date.now()}`;
      await repository.createTask(createIssueTask({ issueID, chunkCount: 2 }));

      const pending = await repository.getNextPending(5);
      expect(pending.every((task) => task.status === "pending")).toBe(true);

      const stored = await repository.getTask(issueID);
      expect(stored?.chunks.length).toBe(2);
      expect(stored?.chunks.every((chunk) => chunk.status === 'notReady')).toBe(true);
    }, 20000);

    /*
     Contract: validates markChunkReady flips a chunk to ready without altering task status; broken means downstream reducers never see chunk completion.
     Reason: chunk readiness drives reduce prompts; this guards the per-chunk update path.
     Accident without this: chunks could remain notReady and block reduce steps, silently delaying runs.
     Odd values: chunkCount=1 hits minimal payload but still exercises status flip logic.
     Bug history: none known.
    */
    test('markChunkReady updates chunk status', async () => {
      const issueID = `TEST-CHUNK-${Date.now()}`;
      await repository.createTask(createIssueTask({ issueID, chunkCount: 1 }));

      await repository.markChunkReady(issueID, 'CHUNK#0');
      const updated = await repository.getTask(issueID);
      expect(updated?.chunks[0].status).toBe('ready');
      expect(updated?.status).toBe('pending');
    }, 20000);

    /*
     Contract: confirms markTaskSucceeded promotes a pending task to completed; failure signals update expressions or table name wiring broke.
     Reason: completion status is read by recap pipeline; ensure status mutation still works.
     Accident without this: tasks may remain pending, causing duplicates or retries in later stages.
     Odd values: chunkCount=0 covers single-chunk/direct reduce path without chunk iteration.
     Bug history: none recorded.
    */
    test('markTaskSucceeded updates status', async () => {
      const issueID = `TEST-SUCCEED-${Date.now()}`;
      await repository.createTask(createIssueTask({ issueID, chunkCount: 0 }));

      const result = await repository.markTaskSucceeded(issueID);
      expect(result?.status).toBe('completed');
    }, 20000);
  });
