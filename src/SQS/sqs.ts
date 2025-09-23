import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';

import { getAwsClientConfig } from '@utils/aws';

export type PromptTaskMessage = {
  type: 'prompt';
  url: string; // s3://bucket/key
  meta?: Record<string, any>;
  llm: string;
  llmModel: string;
  delayMs?: number;
};

function ensureValidPromptItem(item: PromptTaskMessage, index: number): void {
  if (!item || typeof item !== 'object') {
    throw new Error(`item at index ${index} must be an object`);
  }

  const url = typeof item.url === 'string' ? item.url.trim() : '';
  if (!url.length) {
    throw new Error('url must be a non-empty string');
  }

  if (item.delayMs !== undefined) {
    if (typeof item.delayMs !== 'number' || !Number.isFinite(item.delayMs) || item.delayMs < 0) {
      throw new Error('delayMs, when provided, must be a finite number >= 0');
    }
  }
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

  const urls = args.items.map((item, index) => {
    ensureValidPromptItem(item, index);
    return item.url.trim();
  });

  const entries: Array<{ Id: string; MessageBody: string; DelaySeconds?: number }> = args.items.map((item, index) => {
    const delaySeconds = Math.max(0, Math.min(900, Math.ceil((item.delayMs ?? 0) / 1000)));
    const messageBody = JSON.stringify({
      type: item.type,
      url: urls[index],
      meta: item.meta,
      llm: item.llm,
      llmModel: item.llmModel,
    });
    return {
      Id: `m${index}`,
      MessageBody: messageBody,
      DelaySeconds: delaySeconds || undefined,
    };
  });

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
