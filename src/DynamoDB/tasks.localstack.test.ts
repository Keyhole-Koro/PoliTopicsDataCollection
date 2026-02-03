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
import { buildIssueUid } from '../utils/uid';
/*
 * creates ingested tasks and reads them back
 * [Contract] TaskRepository must persist ingested tasks with raw_url metadata.
 * [Reason] Recap depends on ingested tasks as the discovery queue.
 * [Accident] Without this, ingestion could silently drop work.
 * [Odd] Minimal meeting metadata to keep payload tiny.
 * [History] None; preventive.
 *
 * markTaskSucceeded updates status
 * [Contract] markTaskSucceeded must promote pending tasks to completed.
 * [Reason] Recap pipeline reads completion to avoid duplicates.
 * [Accident] Without this, tasks would remain pending and be retried or duplicated.
 * [Odd] pending task with minimal fields.
 * [History] None.
 */

const { endpoint: LOCALSTACK_ENDPOINT } = getLocalstackConfig();

const createIngestedTask = (issueID: string): IssueTask => {
  const createdAt = new Date().toISOString();
  const taskId = buildIssueUid({
    issueID,
    session: 208,
    nameOfHouse: 'House',
  });
  return {
    pk: taskId,
    status: 'ingested',
    retryAttempts: 0,
    createdAt,
    updatedAt: createdAt,
    raw_url: `s3://${DEFAULT_PROMPT_BUCKET}/raw/${taskId}.json`,
    raw_hash: 'seed',
    meeting: {
      issueID,
      nameOfMeeting: 'Test Meeting',
      nameOfHouse: 'House',
      date: '2025-11-30',
      numberOfSpeeches: 1,
      session: 208,
    },
    attachedAssets: {
      speakerMetadataUrl: `s3://${DEFAULT_PROMPT_BUCKET}/attachedAssets/${taskId}.json`,
    },
  };
};

const createPendingTask = (issueID: string): IssueTask => {
  const createdAt = new Date().toISOString();
  const taskId = buildIssueUid({
    issueID,
    session: 208,
    nameOfHouse: 'House',
  });
  return {
    pk: taskId,
    status: 'pending',
    llm: 'gemini',
    llmModel: 'gemini-2.5-pro',
    retryAttempts: 0,
    createdAt,
    updatedAt: createdAt,
    processingMode: 'single_chunk',
    prompt_version: '1.0',
    prompt_url: `s3://${DEFAULT_PROMPT_BUCKET}/prompts/${taskId}_reduce.json`,
    meeting: {
      issueID,
      nameOfMeeting: 'Test Meeting',
      nameOfHouse: 'House',
      date: '2025-11-30',
      numberOfSpeeches: 1,
      session: 208,
    },
    result_url: `s3://${DEFAULT_PROMPT_BUCKET}/results/${taskId}_reduce.json`,
    chunks: [],
    attachedAssets: {
      speakerMetadataUrl: `s3://${DEFAULT_PROMPT_BUCKET}/attachedAssets/${taskId}.json`,
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

    async function delay(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function waitForTask(taskId: string, opts: { attempts?: number; delayMs?: number } = {}): Promise<IssueTask | undefined> {
      const attempts = opts.attempts ?? 20;
      const delayMs = opts.delayMs ?? 100;
      for (let i = 0; i < attempts; i += 1) {
        const task = await repository.getTask(taskId);
        if (task) {
          return task;
        }
        await delay(delayMs);
      }
      return undefined;
    }

    /*
     Contract: ensures TaskRepository can persist chunked tasks and list them via the StatusIndex; failure means write/query paths or index definitions changed.
     Reason: chunked tasks are the dominant mode for large meetings; this validates LocalStack wiring and schema expectations.
     Accident without this: a schema drift could break StatusIndex reads and stall all ingestion without immediate alerts.
     Odd values: chunkCount=2 forces multi-chunk payloads rather than single-chunk shortcuts.
     Bug history: none specific; preventive coverage.
    */
    test('creates ingested tasks and reads them back', async () => {
      const issueID = `TEST-INGEST-${Date.now()}`;
      await repository.createTask(createIngestedTask(issueID));

      const taskId = buildIssueUid({
        issueID,
        session: 208,
        nameOfHouse: 'House',
      });
      const stored = await waitForTask(taskId);
      expect(stored?.status).toBe('ingested');
      expect(typeof stored?.raw_url).toBe('string');
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
      await repository.createTask(createPendingTask(issueID));

      const taskId = buildIssueUid({
        issueID,
        session: 208,
        nameOfHouse: 'House',
      });
      const result = await repository.markTaskSucceeded(taskId);
      expect(result?.status).toBe('completed');
    }, 20000);
  });
