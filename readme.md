# PoliTopics‑C

A serverless pipeline that fetches National Diet records, prepares LLM prompt chunks, and fans them out through S3/SQS while tracking aggregation state in DynamoDB. Run logs are written to S3. The project uses **TypeScript** for Lambda code, **Terraform** for infrastructure, and supports both **local development** via LocalStack and **deployment to AWS**.

---

## Highlights

- **Lambda function** `politopics-c`
  - Fetches raw data from the National Diet API
  - Prepares chunked prompts for downstream LLM reducers
  - Tracks chunk aggregation state in DynamoDB for external reduce workers
  - Writes success/error logs to S3
  - **Date range** defaults to the **previous day (JST)** when `FROM_DATE` / `UNTIL_DATE` are not provided

- **Local-first DX**
  - LocalStack recipe (Docker Compose)
  - DynamoDB bootstrap script
  - VS Code **Dev Container** support (`.devcontainer/`)

---

## Requirements

- Node.js 18+
- npm
- Docker (for LocalStack)
- AWS CLI
- Terraform v1.5+
- `zip` (for packaging, if you build a .zip)
- Gemini API key

---


## Local Development (LocalStack)


```bash
npm run local:up

./scripts/local-bootstrap.sh

npm run dev

```

### Architecture at a glance
- Entry: `src/lambda_handler.ts` routes by source:
  - HTTP API (API Gateway): validates `x-api-key`, parses from/until, runs the prompt fan-out.
  - EventBridge (cron): runs the same fan-out for the prior day by default (JST).
  - SQS (retry): handles `run` messages to re-execute a scheduled window after rate limits.
- Prompt preparation lives in `src/prompts/` (`prompts.ts`, `splitPrompts.ts`) where templates and chunk splitting are defined.
- Storage & logging helpers: `src/S3/s3.ts` writes run metadata to S3, while DynamoDB aggregation updates are handled inline in the Lambda via conditional `UpdateCommand` calls.
- Retry/orchestration utilities: `src/utils/async.ts`, `src/utils/range.ts`, and `src/utils/errors.ts` keep concurrency and error reporting predictable.

### Key configuration
- `CONCURRENCY`: max number of chunk uploads handled in parallel (default 4).
- `PROMPT_CHUNK_SIZE`: number of speeches per chunk (default 10).
- `PROMPT_S3_PREFIX`: optional override for the chunk object prefix (default `prompt-chunks`).
- `REDUCE_QUEUE_URL`: SQS queue notified once all parts arrive (consumed by the external reducer).

### Local testing
- Prompt pipeline unit test: `npm test -- lambda_handler`
- Utility tests: `npm test -- src/utils/rateLimit.test.ts`
- SQS LocalStack integration test (requires LocalStack with the SQS service enabled): `AWS_ENDPOINT_URL=http://localhost:4566 npm test -- sqs.localstack`
- Local invoke: `npm run dev`
---



## Logs

If `ERROR_BUCKET` is set, the Lambda stores run metadata in S3:

- `success/` — Successful runs (metadata + stored IDs)
- `error/` — Failed runs (serialized error)

Example S3 keys:

```
success/2025-08-11T13:48:32.270Z-<uuid>.json
error/2025-08-11T14:05:12.100Z-<uuid>.json
```
## Prompt chunk aggregation

- Prompt chunk fan-out now follows the "S3 + SQS + DynamoDB" aggregation pattern.
- Chunks are written to S3 under `prompt-chunks/<aggregateId>/part-XXXX.json` with metadata (`total-parts`, `part-index`, `run-id`).
- Every chunk publish emits an SQS message (`type = prompt_chunk_ready`) containing `aggregateId`, `partIndex`, `totalParts`, and table keys for idempotent processing.
- The Lambda's SQS handler keeps an aggregation record in DynamoDB (`PK = PROMPT_AGG#<aggregateId>`) and triggers a reduce job when all parts arrive.
- Reduce tasks are sent to `REDUCE_QUEUE_URL` (`type = prompt_reduce`) with the S3 prefix so downstream reducers can rebuild the full meeting.

### Fan-out configuration
- `PROMPT_S3_PREFIX` (optional): override the S3 prefix for chunk payloads. Defaults to `prompt-chunks`.
- `REDUCE_QUEUE_URL`: SQS queue that receives reduce tasks once all parts are present.
