import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';

import { getAwsClientConfig } from '@utils/aws';

const MAX_SQS_DELAY_SECONDS = 900;

export type BasePromptTaskMessage = {
  meta?: Record<string, any>;
  llm: string;
  llmModel: string;
  delayMs?: number;
  retryAttempts?: number;
};

export type MapPromptTaskMessage = BasePromptTaskMessage & {
  type: 'map';
  url: string; // s3://bucket/key payload
  result_url?: string; // optional s3://bucket/key for LLM output
};

export type ReducePromptTaskMessage = BasePromptTaskMessage & {
  type: 'reduce';
  chunk_result_urls: string[]; // s3://bucket/key list produced by chunk stage
  prompt: string;
  issueID: string;
  meeting: {
    issueID: string;
    nameOfMeeting: string;
    nameOfHouse: string;
    date: string;
    numberOfSpeeches: number;
  };
};

export type PromptTaskMessage = MapPromptTaskMessage | ReducePromptTaskMessage;

type MapQueuePayload = {
  type: 'map';
  url: string;
  result_url?: string;
  meta?: Record<string, any>;
  llm: string;
  llmModel: string;
  retryAttempts: number;
};

type ReduceQueuePayload = {
  type: 'reduce';
  chunk_result_urls: string[];
  prompt: string;
  issueID: string;
  meeting: ReducePromptTaskMessage['meeting'];
  meta?: Record<string, any>;
  llm: string;
  llmModel: string;
  retryAttempts: number;
};

type NormalisedItem = {
  delaySeconds?: number;
  body: MapQueuePayload | ReduceQueuePayload;
};

const trimString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function ensureRetryAttempts(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('retryAttempts, when provided, must be a finite number >= 0');
  }
  return Math.floor(value);
}

function normaliseDelaySeconds(delayMs: number | undefined): number | undefined {
  if (delayMs === undefined) return undefined;
  if (typeof delayMs !== 'number' || !Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error('delayMs, when provided, must be a finite number >= 0');
  }
  const seconds = Math.ceil(delayMs / 1000);
  if (seconds <= 0) return undefined;
  return Math.min(MAX_SQS_DELAY_SECONDS, seconds);
}

function normalisePromptItem(item: PromptTaskMessage, index: number): NormalisedItem {
  if (!item || typeof item !== 'object') {
    throw new Error(`item at index ${index} must be an object`);
  }

  const llm = trimString(item.llm);
  const llmModel = trimString(item.llmModel);
  if (!llm) throw new Error('llm must be a non-empty string');
  if (!llmModel) throw new Error('llmModel must be a non-empty string');

  const retryAttempts = ensureRetryAttempts(item.retryAttempts);
  const delaySeconds = normaliseDelaySeconds(item.delayMs);

  if (item.type === 'map') {
    const url = trimString(item.url);
    if (!url) {
      throw new Error('map tasks require a non-empty url');
    }
    const resultUrl = trimString(item.result_url);

    const body: MapQueuePayload = {
      type: 'map',
      url,
      meta: item.meta,
      llm,
      llmModel,
      retryAttempts,
    };
    if (resultUrl) {
      body.result_url = resultUrl;
    }

    return {
      delaySeconds,
      body,
    };
  }

  if (item.type === 'reduce') {
    const prompt = trimString(item.prompt);
    if (!prompt) {
      throw new Error('reduce tasks require a non-empty prompt');
    }

    const issueID = trimString(item.issueID);
    if (!issueID) {
      throw new Error('reduce tasks require issueID');
    }

    if (!Array.isArray(item.chunk_result_urls) || !item.chunk_result_urls.length) {
      throw new Error('reduce tasks require at least one chunk_result_url');
    }

    const chunkResultUrls = item.chunk_result_urls
      .map((candidate) => trimString(candidate))
      .filter((candidate) => candidate.length > 0);

    if (!chunkResultUrls.length) {
      throw new Error('reduce tasks require at least one valid chunk_result_url');
    }

    if (!item.meeting || typeof item.meeting !== 'object') {
      throw new Error('reduce tasks require meeting metadata');
    }

    const body: ReduceQueuePayload = {
      type: 'reduce',
      chunk_result_urls: chunkResultUrls,
      prompt,
      issueID,
      meeting: item.meeting,
      meta: item.meta,
      llm,
      llmModel,
      retryAttempts,
    };

    return {
      delaySeconds,
      body,
    };
  }

  throw new Error(`Unsupported prompt task type at index ${index}`);
}

export async function enqueuePromptsWithS3Batch(args: {
  items: PromptTaskMessage[];
  queueUrl?: string;        // defaults PROMPT_QUEUE_URL or CHUNK_QUEUE_URL
}): Promise<{ queued: number }> {
  const queueUrl = args.queueUrl || process.env.PROMPT_QUEUE_URL || process.env.CHUNK_QUEUE_URL;
  if (!queueUrl) {
    console.warn('[PromptQueue] No queue URL configured (PROMPT_QUEUE_URL/CHUNK_QUEUE_URL)');
    return { queued: 0 };
  }

  if (!args.items.length) {
    return { queued: 0 };
  }

  const cfg = getAwsClientConfig();
  const sqs = new SQSClient(cfg);

  const normalised = args.items.map((item, index) => normalisePromptItem(item, index));

  const entries: Array<{ Id: string; MessageBody: string; DelaySeconds?: number }> = normalised.map((item, index) => ({
    Id: `m${index}`,
    MessageBody: JSON.stringify(item.body),
    DelaySeconds: item.delaySeconds,
  }));

  // Send in batches of 10 (SQS limit)
  let sent = 0;
  for (let i = 0; i < entries.length; i += 10) {
    const slice = entries.slice(i, i + 10);
    await sqs.send(new SendMessageBatchCommand({ QueueUrl: queueUrl, Entries: slice }));
    sent += slice.length;
  }

  console.log(`[PromptQueue] Enqueued ${sent} prompt(s)`);
  return { queued: sent };
}
