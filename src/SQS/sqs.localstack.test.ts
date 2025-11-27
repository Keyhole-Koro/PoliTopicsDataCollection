import {
  DeleteMessageBatchCommand,
  PurgeQueueCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { enqueuePromptsWithS3Batch, type PromptTaskMessage } from './sqs';

const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_URL || process.env.AWS_ENDPOINT_URL || 'http://127.0.0.1:4566';
const TERRAFORM_BIN = process.env.TERRAFORM_BIN || 'terraform';
const TERRAFORM_DIR = path.resolve(__dirname, '..', '..', 'terraform', 'localstack');
const execFileAsync = promisify(execFile);

async function runTerraformCommand(args: string[], env: NodeJS.ProcessEnv) {
  try {
    const result = await execFileAsync(TERRAFORM_BIN, args, {
      cwd: TERRAFORM_DIR,
      env,
      windowsHide: true,
    });
    return {
      stdout: result.stdout?.toString() ?? '',
      stderr: result.stderr?.toString() ?? '',
    };
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      throw err;
    }

    const stderr = err?.stderr ? err.stderr.toString() : err?.message || String(err);
    throw new Error(`Terraform command failed (terraform ${args.join(' ')}): ${stderr}`);
  }
}

describe('enqueuePromptsWithS3Batch (LocalStack)', () => {
  const ORIGINAL_ENV = process.env;
  const queueName = `politopics-test-${Date.now()}`;

  let queueUrl: string | undefined;
  let sqs: SQSClient | undefined;
  let terraformEnv: NodeJS.ProcessEnv | undefined;
  let skipSuite = false;
  let terraformApplied = false;

  async function ensureTerraformAvailable() {
    try {
      await execFileAsync(TERRAFORM_BIN, ['version'], { windowsHide: true });
      return true;
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        console.warn('Terraform binary not found; skipping LocalStack SQS integration test.');
        return false;
      }

      console.warn('Unable to execute Terraform version check:', err?.message || err);
      return false;
    }
  }

  beforeAll(async () => {
    process.env = { ...ORIGINAL_ENV };
    process.env.AWS_REGION = process.env.AWS_REGION || 'ap-northeast-3';
    process.env.AWS_ENDPOINT_URL = LOCALSTACK_ENDPOINT;

    try {
      const terraformAvailable = await ensureTerraformAvailable();
      if (!terraformAvailable) {
        skipSuite = true;
        return;
      }

      terraformEnv = {
        ...process.env,
        TF_IN_AUTOMATION: '1',
        TF_INPUT: '0',
        AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || 'test',
        AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || 'test',
        AWS_REGION: process.env.AWS_REGION,
        AWS_DEFAULT_REGION: process.env.AWS_REGION,
        TF_VAR_queue_name: queueName,
        TF_VAR_localstack_endpoint: LOCALSTACK_ENDPOINT,
      };

      await runTerraformCommand(['init', '-input=false'], terraformEnv);
      await runTerraformCommand(['apply', '-auto-approve', '-input=false'], terraformEnv);
      terraformApplied = true;

      const { stdout: queueUrlStdout } = await runTerraformCommand(['output', '-raw', 'prompt_queue_url'], terraformEnv);
      const queueUrlValue = queueUrlStdout.trim();
      queueUrl = queueUrlValue;
      if (!queueUrl) {
        throw new Error('Terraform output "prompt_queue_url" was empty');
      }

      process.env.PROMPT_QUEUE_URL = queueUrl;

      sqs = new SQSClient({ region: process.env.AWS_REGION, endpoint: LOCALSTACK_ENDPOINT });

      try {
        await sqs.send(new PurgeQueueCommand({ QueueUrl: queueUrl }));
      } catch (purgeErr: any) {
        if (purgeErr?.name !== 'PurgeQueueInProgress' && purgeErr?.Code !== 'PurgeQueueInProgress') {
          throw purgeErr;
        }
      }
    } catch (err: any) {
      console.warn('Skipping LocalStack SQS integration test:', err?.message || err);
      queueUrl = undefined;
      skipSuite = true;
      terraformEnv = undefined;
      terraformApplied = false;
    }
  }, 60000);

  afterAll(async () => {
    if (terraformEnv && terraformApplied) {
      try {
        await runTerraformCommand(['destroy', '-auto-approve', '-input=false'], terraformEnv);
      } catch (destroyErr: any) {
        console.warn('Failed to destroy Terraform-managed LocalStack resources:', destroyErr?.message || destroyErr);
      }
    }
    process.env = ORIGINAL_ENV;
  });

  test('publishes batches that can be read from SQS', async () => {
    if (skipSuite || !queueUrl || !sqs) {
      return; // LocalStack not available; test skipped at runtime.
    }

    const items: PromptTaskMessage[] = [
      {
        type: 'map',
        url: 's3://politopics-prompts/a.json',
        result_url: 's3://politopics-results/a.json',
        llm: 'gemini',
        llmModel: 'gemini-2.5-pro',
        retryAttempts: 0,
        retryMs_in: 0,
        meta: { chunk: 1 },
      },
      {
        type: 'map',
        url: 's3://politopics-prompts/b.json',
        result_url: 's3://politopics-results/b.json',
        llm: 'gemini',
        llmModel: 'gemini-2.5-pro',
        retryAttempts: 0,
        retryMs_in: 0,
        meta: { chunk: 2 },
      },
    ];

    const result = await enqueuePromptsWithS3Batch({ items, queueUrl });
    expect(result.queued).toBe(items.length);

    const received = new Map<string, { body: any; receiptHandle: string }>();
    for (let attempt = 0; attempt < 8 && received.size < items.length; attempt += 1) {
      const res = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
        VisibilityTimeout: 0,
      }));

      for (const message of res.Messages || []) {
        if (message.Body && message.ReceiptHandle && message.MessageId) {
          if (received.has(message.MessageId)) {
            continue;
          }
          console.log('[LocalStack SQS] message body:', message.Body);
          received.set(message.MessageId, {
            body: JSON.parse(message.Body),
            receiptHandle: message.ReceiptHandle,
          });
        }
      }
    }

    expect(received.size).toBe(items.length);

    const bodies = Array.from(received.values()).map((entry) => entry.body);
    expect(bodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'map',
          url: 's3://politopics-prompts/a.json',
          result_url: 's3://politopics-results/a.json',
          llm: 'gemini',
          llmModel: 'gemini-2.5-pro',
          meta: expect.objectContaining({ chunk: 1 }),
        }),
        expect.objectContaining({
          type: 'map',
          url: 's3://politopics-prompts/b.json',
          result_url: 's3://politopics-results/b.json',
          llm: 'gemini',
          llmModel: 'gemini-2.5-pro',
          meta: expect.objectContaining({ chunk: 2 }),
        }),
      ]),
    );

    const deletes = Array.from(received.values()).map((entry, index) => ({
      Id: `d${index}`,
      ReceiptHandle: entry.receiptHandle,
    }));

    if (deletes.length) {
      await sqs.send(new DeleteMessageBatchCommand({ QueueUrl: queueUrl, Entries: deletes }));
    }
  }, 20000);
});
