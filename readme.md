# PoliTopics-Data-Collection

PoliTopics-Data-Collection is a serverless data pipeline that downloads Japanese National Diet records, breaks them into LLM-friendly prompt chunks, stores the payloads in S3, and tracks fan-out task state entirely in DynamoDB. The codebase is written in TypeScript and targets AWS Lambda; Terraform modules define the cloud deployment and LocalStack enables a local-first workflow.

## Architecture

- `src/lambda_handler.ts` is the Lambda entry point. It can be triggered by:
  - API Gateway: validates an `x-api-key` header and accepts a run range.
  - EventBridge: cron trigger that replays the previous JST day.
- Prompt preparation lives under `src/prompts/` and uses token-aware packing helpers from `src/utils/`.
- Chunk payloads are written to S3 (`putJsonS3`) and corresponding DynamoDB tasks are created via `TaskRepository` in `src/DynamoDB/tasks.ts`.
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
- `LLM_TASK_TABLE` is the DynamoDB table where prompt tasks are stored.
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

> The bundled `docker-compose.yml` sets `LAMBDA_EXECUTOR=local` so LocalStack can run Lambda functions without needing nested Docker access. Keep that config (or expose a working Docker socket) if you customise the stack; otherwise Lambda creation will fail during Terraform applies.

Bootstrap LocalStack buckets and tables:

```bash
npm run local:bootstrap
```

Set `AWS_ENDPOINT_URL=http://localhost:4566` (or your LocalStack endpoint) so all AWS SDK clients target LocalStack. The helper in `src/utils/aws.ts` automatically forwards the endpoint to all clients.

### Terraform Local Runs

The old `npm run dev` helper that invoked the Lambda directly has been removed. To exercise the full stack locally, deploy it to LocalStack with Terraform instead:

1. Build the Lambda bundle so Terraform can package it:
   ```bash
   npm run build
   ```
2. Make sure LocalStack is running (`npm run local:up`).
3. Apply the LocalStack tfvars profile (backend disabled so state stays local):
   ```bash
   terraform -chdir=./terraform init -backend=false
   terraform -chdir=./terraform apply -var-file=tfvars/localstack.tfvars
   ```

> LocalStack's community image still doesn't emulate API Gateway v2 HTTP APIs. The `tfvars/localstack.tfvars` profile sets `enable_http_api = false` so Terraform skips those resources locally; use LocalStack Pro or AWS when you need the HTTP API.

4. (Optional) When the HTTP API is enabled, fetch the endpoint and call it with the configured API key:
   ```bash
   export RUN_API_KEY=...
   ENDPOINT=$(terraform -chdir=./terraform output -raw http_api_endpoint)
   curl -H "x-api-key: $RUN_API_KEY" -X POST "$ENDPOINT/run"
   ```

This flow provisions the Lambda, API Gateway (when enabled), buckets, and DynamoDB task table against LocalStack so you can validate cron and HTTP invocations end-to-end. Additional Terraform details live in `doc/terraform.md`.

## Testing

Jest is configured through `jest.config.js` with path aliases for the `src/` tree.

- Unit tests (example selections):
  - Prompt pipeline (unit + optional LocalStack integration): `AWS_ENDPOINT_URL=http://localhost:4566 npm test -- lambda_handler`
  - Utility tests: `npm test -- src/utils/rateLimit.test.ts`
- Lambda integration with mocked external APIs: `npm test -- lambda_handler.mock.test.ts`
- `/run` handler contract tests: `npm test -- lambda_handler.run.test.ts`

## Create state bucket

```bash
./create-state-bucket.sh stage
./create-state-bucket.sh production
```

## Import manually

```bash
./import_all.sh tfvars/stage.tfvars
```

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

- Chunk prompts are written to `s3://politopics-prompts/prompts/<issueId>_<chunk-indices>.json` and tracked inside the DynamoDB record for that issue.
- Each DynamoDB record (`pk = issueID`) contains a `chunks[]` array describing every chunk’s prompt key, result location, and readiness (`notReady` or `ready`).
- Workers read pending records, process the first `notReady` chunk, update its status, and once all chunks are `ready` they can execute the final reduce step using the `prompt_url` metadata on the same record.

## Troubleshooting

- If the Lambda exits early with `GEMINI_MAX_INPUT_TOKEN is not set` or `GOOGLE_API_KEY is not set`, confirm both variables exist before invoking the handler.
- Use the integration test logs to validate S3 payload structure before wiring downstream reducers.
