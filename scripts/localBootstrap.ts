import 'dotenv/config';

import { CreateBucketCommand, HeadBucketCommand, S3Client, BucketLocationConstraint } from '@aws-sdk/client-s3';
import { CreateQueueCommand, GetQueueUrlCommand, SQSClient } from '@aws-sdk/client-sqs';

const endpoint = process.env.AWS_ENDPOINT_URL ?? 'http://localhost:4566';
const region = process.env.AWS_REGION ?? 'ap-northeast-3';
const promptBucket = process.env.PROMPT_BUCKET ?? 'politopics-prompts';
const errorBucket = process.env.ERROR_BUCKET ?? 'politopics-error-logs';
const promptQueueName = process.env.PROMPT_QUEUE_NAME ?? 'politopics-prompt-queue';

const s3 = new S3Client({ region, endpoint, forcePathStyle: true });
const sqs = new SQSClient({ region, endpoint });

function log(message: string) {
  console.log(message);
}

async function ensureBucket(bucket: string): Promise<void> {
  const trimmed = bucket.trim();
  if (!trimmed.length) return;

  try {
    await s3.send(new HeadBucketCommand({ Bucket: trimmed }));
    log(`Bucket ${trimmed} already exists`);
    return;
  } catch (err: any) {
    const status = err?.$metadata?.httpStatusCode ?? err?.$response?.statusCode;
    if (status && status !== 404) {
      throw err;
    }
  }

  const createInput =
    region === "us-east-1"
      ? { Bucket: trimmed }
      : {
          Bucket: trimmed,
          CreateBucketConfiguration: { LocationConstraint: region as BucketLocationConstraint },
        };

  await s3.send(new CreateBucketCommand(createInput));
  log(`Created bucket ${trimmed}`);
}

async function ensureQueue(name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed.length) {
    throw new Error('Queue name must be a non-empty string');
  }

  try {
    const existing = await sqs.send(new GetQueueUrlCommand({ QueueName: trimmed }));
    if (existing.QueueUrl) {
      log(`Queue ${trimmed} already exists`);
      return existing.QueueUrl;
    }
  } catch (err: any) {
    const code = err?.name ?? err?.Code;
    if (code && code !== 'AWS.SimpleQueueService.NonExistentQueue' && code !== 'QueueDoesNotExist') {
      throw err;
    }
  }

  const created = await sqs.send(
    new CreateQueueCommand({
      QueueName: trimmed,
      Attributes: {
        VisibilityTimeout: '30',
        DelaySeconds: '0',
      },
    })
  );

  if (!created.QueueUrl) {
    throw new Error(`Failed to create queue ${trimmed}`);
  }

  log(`Created queue ${trimmed}`);
  return created.QueueUrl;
}

async function main() {
  log(`Using endpoint: ${endpoint}`);
  log(`Using region:   ${region}`);

  await ensureBucket(promptBucket);

  if (errorBucket.trim().length) {
    await ensureBucket(errorBucket);
  }

  const queueUrl = await ensureQueue(promptQueueName);

  log('Bootstrap complete.');
  log('Export the queue URL for local runs:');
  log(`  export PROMPT_QUEUE_URL=${queueUrl}`);
}

main().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exitCode = 1;
});

