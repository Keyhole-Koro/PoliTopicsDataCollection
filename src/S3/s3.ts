import fs from 'fs-extra';
import path from 'node:path';
import crypto from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand } from '@aws-sdk/client-s3';

export async function putJsonS3({ s3, bucket, key, body }: { s3: S3Client; bucket: string; key: string; body: unknown }) {
  const payload = JSON.stringify(body, null, 2);
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: payload, ContentType: 'application/json' }));
  return { bucket, key };
}

export async function writeRunLog(args: {
  kind: 'error' | 'success';
  payload: any;
  s3: S3Client;
  bucket?: string;
  outDir?: string; // local dev target directory
}) {
  const { kind, payload, s3, bucket, outDir } = args;
  const isLocal = (process.env.APP_ENV || '').toLowerCase() === 'local';
  const tsSafe = new Date().toISOString().replace(/[:]/g, '-');
  const fileName = `${tsSafe}-${crypto.randomUUID()}.json`;

  if (isLocal) {
    const dir = path.join(outDir || 'out', kind);
    const filePath = path.join(dir, fileName);
    try {
      await fs.ensureDir(dir);
      await fs.writeJson(filePath, payload, { spaces: 2 });
      console.error(`[LOG] Wrote ${kind} log to ${filePath}`);
    } catch (e) {
      console.error(`[LOG] Failed to write local ${kind} log:`, e);
    }
    return { local: true, path: filePath };
  }

  if (!bucket) return { local: false, skipped: true };
  const key = `${kind}/${fileName}`;
  try {
    await putJsonS3({ s3, bucket, key, body: payload });
    console.error(`[LOG] Wrote ${kind} log to s3://${bucket}/${key}`);
    return { local: false, bucket, key };
  } catch (e) {
    console.error(`[LOG] Failed to write ${kind} log to S3:`, e);
    return { local: false, error: e };
  }
}
