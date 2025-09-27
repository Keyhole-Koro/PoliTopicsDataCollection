import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { BucketLocationConstraint } from '@aws-sdk/client-s3';

import { putJsonS3 } from './s3';

const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_URL || process.env.AWS_ENDPOINT_URL || 'http://127.0.0.1:4566';

describe('putJsonS3 (LocalStack)', () => {
  const ORIGINAL_ENV = process.env;
  const bucket = `politopics-test-${Date.now()}`;

  let s3: S3Client | undefined;
  const keys: string[] = [];

  beforeAll(async () => {
    process.env = { ...ORIGINAL_ENV };
    process.env.AWS_REGION = process.env.AWS_REGION || 'ap-northeast-3';
    process.env.AWS_ENDPOINT_URL = LOCALSTACK_ENDPOINT;

    const region = process.env.AWS_REGION;
    const typedRegion = region as BucketLocationConstraint;

    s3 = new S3Client({ region, endpoint: LOCALSTACK_ENDPOINT, forcePathStyle: true });

    try {
      const createBucketInput =
        region === 'ap-northeast-3'
          ? { Bucket: bucket }
          : { Bucket: bucket, CreateBucketConfiguration: { LocationConstraint: typedRegion } };

      await s3.send(new CreateBucketCommand(createBucketInput));
    } catch (err: any) {
      console.warn('Skipping LocalStack S3 integration test:', err?.message || err);
      s3 = undefined;
    }
  }, 15000);

  afterAll(async () => {
    if (s3) {
      for (const key of keys) {
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        } catch (err) {
          // ignore cleanup errors
        }
      }
      try {
        await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
      } catch (err) {
        // ignore cleanup errors
      }
    }
    process.env = ORIGINAL_ENV;
  });

  test('writes JSON payload to S3 and can be read back', async () => {
    if (!s3) {
      return; // LocalStack not available; skip
    }

    const key = `tests/${Date.now()}.json`;
    const payload = { ok: true, nested: { value: 42 } };

    await putJsonS3({ s3, bucket, key, body: payload });
    keys.push(key);

    const { Body, ContentType } = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await Body?.transformToString();

    expect(ContentType).toBe('application/json');
    expect(body).toBe(JSON.stringify(payload, null, 2));
  });
});
