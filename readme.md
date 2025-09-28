# PoliTopics-Data-Collection

PoliTopics-Data-Collection is a serverless data pipeline that downloads Japanese National Diet records, breaks them into LLM-friendly prompt chunks, stores the payloads in S3, and pushes fan-out jobs through SQS while tracking aggregation state in DynamoDB. The codebase is written in TypeScript and targets AWS Lambda; Terraform modules define the cloud deployment and LocalStack enables a local-first workflow.

## Architecture

- `src/lambda_handler.ts` is the Lambda entry point. It can be triggered by:
  - API Gateway: validates an `x-api-key` header and accepts a run range.
  - EventBridge: cron trigger that replays the previous JST day.
  - SQS: retry queue for reprocessing a range.
- Prompt preparation lives under `src/prompts/` and uses token-aware packing helpers from `src/utils/`.
- Chunk payloads are written to S3 (`putJsonS3`) and queued through `enqueuePromptsWithS3Batch` in `src/SQS/sqs.ts`.
- DynamoDB maintains aggregation progress so reducers can trigger once all parts arrive.

## Requirements

- Node.js 18+
- npm
- Docker (LocalStack)
- AWS CLI
- Terraform v1.5+
- `zip` (needed when creating deployment bundles)
- Gemini API key

## Configuration

Environment variables drive most behaviors:

- `GOOGLE_API_KEY` and `GEMINI_MAX_INPUT_TOKEN` configure Gemini access.
- `PROMPT_QUEUE_URL` (or `CHUNK_QUEUE_URL`) points to the SQS queue for prompt fan-out.
- `RUN_API_KEY` secures the API Gateway entry point.
- `AWS_REGION` defaults to `ap-northeast-3`; override when using another region.
- `AWS_ENDPOINT_URL` targets LocalStack when developing locally (for example, `http://localhost:4566`).
- `ERROR_BUCKET` enables run logs in S3 (`success/` and `error/` prefixes).

Provide these via `.env`, your shell, or the AWS Lambda configuration.

## Local Development

Start LocalStack and DynamoDB admin:

   ```bash
   npm run local:up
   ```

Bootstrap LocalStack buckets and queues:

   ```bash
   npm run local:bootstrap
   ```

Export `PROMPT_QUEUE_URL` from the output and set `AWS_ENDPOINT_URL=http://localhost:4566` (or your LocalStack endpoint) so all AWS SDK clients target LocalStack. The helper in `src/utils/aws.ts` automatically forwards the endpoint to all clients.

## Testing

Jest is configured through `jest.config.js` with path aliases for the `src/` tree.

- Unit tests (example selections):
  - Prompt pipeline (unit + optional LocalStack integration): `AWS_ENDPOINT_URL=http://localhost:4566 npm test -- lambda_handler`
  - Utility tests: `npm test -- src/utils/rateLimit.test.ts`
- Lambda integration with mocked external APIs: `npm test -- lambda_handler.integration`
- SQS integration test with LocalStack:

  ```bash
  AWS_ENDPOINT_URL=http://localhost:4566 npm test -- sqs.localstack
  ```

  This test spins up a throwaway queue, enqueues sample prompt messages, receives them back, and logs each payload with a `[LocalStack SQS] message body:` prefix so you can inspect exactly what was sent. Keep LocalStack running with the SQS service enabled before executing the test.
- S3 integration test with LocalStack:

  ```bash
  AWS_ENDPOINT_URL=http://localhost:4566 npm test -- s3.localstack
  ```

  Verifies that `putJsonS3` writes JSON with `application/json` content type and that the payload can be read back from LocalStack S3.

## Inspecting LocalStack SQS

- Run `npm run local:up` so LocalStack (with SQS enabled) is listening on `http://localhost:4566`.
- Export or prefix `AWS_ENDPOINT_URL=http://localhost:4566` so SDK calls and the integration test target LocalStack.
- To check queued data manually, use the AWS CLI (or `awslocal`) after enqueuing messages:

  ```bash
  aws --endpoint-url http://localhost:4566 sqs receive-message --queue-url "$PROMPT_QUEUE_URL" --max-number-of-messages 5 --attribute-names All --message-attribute-names All
  ```

  Combine this with the integration test logs to verify payload structure end-to-end.

## Observability

When `ERROR_BUCKET` is set the Lambda writes run metadata to S3:

- `success/` - completed runs
- `error/` - serialized error payloads

Example object keys:

```
success/2025-08-11T13:48:32.270Z-<uuid>.json
error/2025-08-11T14:05:12.100Z-<uuid>.json
```

Cloud logs flow to CloudWatch in AWS or to your LocalStack logging output during local development.

## Prompt Chunk Aggregation

- Chunks are stored at `prompt-chunks/<aggregateId>/part-XXXX.json` with metadata describing the total part count, index, run identifier, and speech IDs.
- Every chunk enqueue emits an SQS message (`type = prompt_chunk_ready`) that reducers consume to track progress in DynamoDB (`PK = PROMPT_AGG#<aggregateId>`).
- Once all parts arrive the reducer emits a `prompt_reduce` task to `REDUCE_QUEUE_URL`, pointing back to the S3 prefix so downstream workers can rebuild the full meeting transcript.

## Troubleshooting

- Ensure LocalStack exposes the SQS service. If the integration test prints `Service 'sqs' is not enabled`, update your LocalStack `SERVICES` configuration or docker-compose file and rerun `npm run local:up`.
- If the Lambda exits early with `GEMINI_MAX_INPUT_TOKEN is not set` or `GOOGLE_API_KEY is not set`, confirm both variables exist before invoking the handler.
- Use the integration test logs to validate message structure before wiring downstream reducers.
