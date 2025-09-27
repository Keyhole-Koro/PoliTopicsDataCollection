import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';

import { getAwsClientConfig } from '@utils/aws';

export type ChunkPromptTaskMessage = {
  type: 'chunk';
  url: string; // s3://bucket/key
  meta?: Record<string, any>;
  llm: string;
  llmModel: string;
  delayMs?: number;
};

export type ReducePromptTaskMessage = {
  type: 'reduce';
  urls: string[]; // s3://bucket/key list for reducer
  meta?: Record<string, any>;
  llm: string;
  llmModel: string;
  delayMs?: number;
};

export type PromptTaskMessage = ChunkPromptTaskMessage | ReducePromptTaskMessage;

type NormalisedItem = {
  urlsForSummary: string[];
  delaySeconds?: number;
  body: {
    type: PromptTaskMessage['type'];
    url?: string;
    urls?: string[];
    meta?: Record<string, any>;
    llm: string;
    llmModel: string;
  };
};

function normalisePromptItem(item: PromptTaskMessage, index: number): NormalisedItem {
  if (!item || typeof item !== 'object') {
    throw new Error(`item at index ${index} must be an object`);
  }

  const llm = typeof item.llm === 'string' ? item.llm.trim() : '';
  const llmModel = typeof item.llmModel === 'string' ? item.llmModel.trim() : '';

  if (!llm) throw new Error('llm must be a non-empty string');
  if (!llmModel) throw new Error('llmModel must be a non-empty string');

  if (item.delayMs !== undefined) {
    if (typeof item.delayMs !== 'number' || !Number.isFinite(item.delayMs) || item.delayMs < 0) {
      throw new Error('delayMs, when provided, must be a finite number >= 0');
    }
  }

  const delaySeconds = Math.max(0, Math.min(900, Math.ceil((item.delayMs ?? 0) / 1000)));

  if (item.type === 'chunk') {
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    if (!url) {
      throw new Error('chunk tasks require a non-empty url');
    }

    return {
      urlsForSummary: [url],
      delaySeconds: delaySeconds || undefined,
      body: {
        type: 'chunk',
        url,
        meta: item.meta,
        llm,
        llmModel,
      },
    };
  }

  if (item.type === 'reduce') {
    if (!Array.isArray(item.urls) || !item.urls.length) {
      throw new Error('reduce tasks require at least one url in urls[]');
    }
    const trimmedUrls = item.urls
      .map((candidate) => (typeof candidate === 'string' ? candidate.trim() : ''))
      .filter((candidate) => candidate.length > 0);

    if (!trimmedUrls.length) {
      throw new Error('reduce tasks require at least one valid url');
    }

    return {
      urlsForSummary: trimmedUrls,
      delaySeconds: delaySeconds || undefined,
      body: {
        type: 'reduce',
        urls: trimmedUrls,
        meta: item.meta,
        llm,
        llmModel,
      },
    };
  }

  throw new Error(`Unsupported prompt task type at index ${index}`);
}

export async function enqueuePromptsWithS3Batch(args: {
  items: PromptTaskMessage[];
  queueUrl?: string;        // defaults PROMPT_QUEUE_URL or CHUNK_QUEUE_URL
}): Promise<{ queued: number; urls: string[] }> {
  const queueUrl = args.queueUrl || process.env.PROMPT_QUEUE_URL || process.env.CHUNK_QUEUE_URL;
  if (!queueUrl) {
    console.warn('[PromptQueue] No queue URL configured (PROMPT_QUEUE_URL/CHUNK_QUEUE_URL)');
    return { queued: 0, urls: [] };
  }

  const cfg = getAwsClientConfig();
  const sqs = new SQSClient(cfg);

  if (!args.items.length) {
    return { queued: 0, urls: [] };
  }

  const normalised = args.items.map((item, index) => normalisePromptItem(item, index));

  const urls = normalised.flatMap((entry) => entry.urlsForSummary);

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
  return { queued: sent, urls };
}
