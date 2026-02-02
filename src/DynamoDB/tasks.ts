import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import { appConfig } from '../config';

const STATUS_INDEX = 'StatusIndex';
const DEFAULT_TABLE_NAME = appConfig.llmTaskTable;

const nowIso = (): string => new Date().toISOString();

export type TaskStatus = 'ingested' | 'pending' | 'remake' | 'completed';
export type ChunkStatus = 'notReady' | 'ready';
export type ReduceProcessingMode = 'single_chunk' | 'chunked';

export type Meeting = {
  issueID: string;
  nameOfMeeting: string;
  nameOfHouse: string;
  date: string;
  numberOfSpeeches: number;
  session: number;
};

export type ChunkItem = {
  id: string;
  prompt_key: string;
  prompt_url: string;
  result_url: string;
  status: ChunkStatus;
};

export type AttachedAssets = {
  speakerMetadataUrl: string;
};

export type IssueTask = {
  pk: string; // issueID
  status: TaskStatus;
  llm?: string;
  llmModel?: string;
  retryAttempts?: number;
  createdAt: string;
  updatedAt: string;
  processingMode?: ReduceProcessingMode;
  prompt_version?: string;
  prompt_url?: string;
  raw_url?: string;
  raw_hash?: string;
  meeting: Meeting;
  result_url?: string;
  chunks?: ChunkItem[];
  attachedAssets: AttachedAssets;
};

function createDocumentClient(): DynamoDBDocumentClient {
  const { region, endpoint, credentials } = appConfig.aws;
  const client = new DynamoDBClient({ region, endpoint, credentials });
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

export class TaskRepository {
  private readonly tableName: string;
  private readonly docClient: DynamoDBDocumentClient;

  constructor(opts: { tableName?: string; client?: DynamoDBDocumentClient } = {}) {
    this.tableName = opts.tableName || DEFAULT_TABLE_NAME;
    this.docClient = opts.client || createDocumentClient();
  }

  async createTask(task: IssueTask): Promise<void> {
    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: task,
      ConditionExpression: 'attribute_not_exists(pk)',
    }));
  }

  async getNextPending(limit = 1): Promise<IssueTask[]> {
    const res = await this.docClient.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: STATUS_INDEX,
      KeyConditionExpression: '#status = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':pending': 'pending' },
      Limit: limit,
      ScanIndexForward: true,
    }));
    return (res.Items as IssueTask[]) || [];
  }

  async getTask(issueID: string): Promise<IssueTask | undefined> {
    const res = await this.docClient.send(new GetCommand({
      TableName: this.tableName,
      Key: { pk: issueID },
    }));
    return res.Item as IssueTask | undefined;
  }

  async markChunkReady(issueID: string, chunkId: string): Promise<IssueTask | undefined> {
    const task = await this.getTask(issueID);
    if (!task?.chunks?.length) {
      return task;
    }

    let changed = false;
    const nextChunks = task.chunks.map((chunk) => {
      if (chunk.id !== chunkId) {
        return chunk;
      }
      if (chunk.status === 'ready') {
        return chunk;
      }
      changed = true;
      return { ...chunk, status: 'ready' };
    });

    if (!changed) {
      return task;
    }

    const res = await this.docClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { pk: issueID },
      UpdateExpression: 'SET chunks = :chunks, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':chunks': nextChunks,
        ':updatedAt': nowIso(),
      },
      ReturnValues: 'ALL_NEW',
    }));
    return res.Attributes as IssueTask | undefined;
  }

  async markTaskSucceeded(issueID: string): Promise<IssueTask | undefined> {
    const res = await this.docClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { pk: issueID },
      UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':status': 'completed',
        ':updatedAt': nowIso(),
      },
      ReturnValues: 'ALL_NEW',
    }));
    return res.Attributes as IssueTask | undefined;
  }
}
