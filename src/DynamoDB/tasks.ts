import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import { getAwsClientConfig } from '@utils/aws';

const STATUS_INDEX = 'StatusIndex';
const DEFAULT_TABLE_NAME = process.env.LLM_TASK_TABLE || 'PoliTopics-llm-tasks';

const nowIso = (): string => new Date().toISOString();
export type TaskStatus = 'pending' | 'succeeded';
export type TaskType = 'map' | 'reduce';

export type TaskBase = {
  pk: string; // issueID
  sk: string; // MAP#<n> or REDUCE
  type: TaskType;
  status: TaskStatus;
  llm: string;
  llmModel: string;
  retryAttempts: number;
  createdAt: string;
  updatedAt: string;
};

export type MapTaskItem = TaskBase & {
  type: 'map';
  sk: `MAP#${number}`;
  url: string;
  result_url: string;
};

export type Meeting = {
  issueID: string;
  nameOfMeeting: string;
  nameOfHouse: string;
  date: string;
  numberOfSpeeches: number;
};

export type ReduceTaskItem = TaskBase & {
  type: 'reduce';
  sk: 'REDUCE';
  chunk_result_urls: string[];
  prompt: string;
  meeting: Meeting;
  result_url: string;
};

function createDocumentClient(): DynamoDBDocumentClient {
  const cfg = getAwsClientConfig();
  const client = new DynamoDBClient(cfg);
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

  async putMapTasks(items: MapTaskItem[]): Promise<void> {
    if (!items.length) return;
    const chunks: MapTaskItem[][] = [];

    items.forEach((item, idx) => {
      const chunkIndex = Math.floor(idx / 25);
      chunks[chunkIndex] = chunks[chunkIndex] || [];
      chunks[chunkIndex].push(item);
    });

    for (const chunk of chunks) {
      const requestItems = chunk.map((item) => ({
        PutRequest: {
          Item: item,
        },
      }));
      await this.docClient.send(new BatchWriteCommand({
        RequestItems: {
          [this.tableName]: requestItems,
        },
      }));
    }
  }

  async putReduceTask(item: ReduceTaskItem): Promise<void> {
    await this.docClient.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
    }));
  }

  async getNextPending(limit = 1): Promise<TaskBase[]> {
    const res = await this.docClient.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: STATUS_INDEX,
      KeyConditionExpression: '#status = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':pending': 'pending' },
      Limit: limit,
      ScanIndexForward: true, // oldest first
    }));
    return (res.Items as TaskBase[]) || [];
  }

  async markTaskSucceeded(issueID: string, sortKey: string): Promise<TaskBase | undefined> {
    const updatedAt = nowIso();
    const res = await this.docClient.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { pk: issueID, sk: sortKey },
      UpdateExpression: 'SET #status = :s, updatedAt = :u',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':s': 'succeeded', ':u': updatedAt },
      ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
      ReturnValues: 'ALL_NEW',
    }));
    return res.Attributes as TaskBase | undefined;
  }

  async countPendingMaps(issueID: string): Promise<number> {
    const res = await this.docClient.send(new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :mapPrefix)',
      ExpressionAttributeValues: { ':pk': issueID, ':mapPrefix': 'MAP#', ':pending': 'pending' },
      FilterExpression: '#status = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      Select: 'COUNT',
    }));
    return res.Count || 0;
  }

  async ensureReduceWhenMapsDone(args: { issueID: string; reduce: ReduceTaskItem }): Promise<boolean> {
    const pendingMaps = await this.countPendingMaps(args.issueID);
    if (pendingMaps > 0) {
      return false;
    }
    try {
      await this.putReduceTask(args.reduce);
      return true;
    } catch (error: any) {
      if (error?.name === 'ConditionalCheckFailedException') {
        return false;
      }
      throw error;
    }
  }
}
