# PoliTopics-Data-Collection

PoliTopics-Data-Collection is a serverless data pipeline that downloads Japanese National Diet records, breaks them into LLM-friendly prompt chunks, stores the payloads in S3, and tracks fan-out task state entirely in DynamoDB. The codebase is written in TypeScript and targets AWS Lambda; Terraform modules define the cloud deployment and LocalStack enables a local-first workflow.

## Requirements

- Node.js 18+
- npm
- Docker (LocalStack)
- AWS CLI
- Terraform v1.6
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

### Terraform Local Runs

./doc/terraform-localstack.md

### Terraform Commands (LocalStack)

Quick reference for the common Terraform workflow when targeting LocalStack:

```bash
cd terraform
terraform init -backend-config=backends/local.hcl
terraform plan -var-file=tfvars/localstack.tfvars -out=tfplan
terraform apply "tfplan"
```

### Invoke the `/run` endpoint

After applying Terraform (stage/production or LocalStack with `enable_http_api = true`), fetch the HTTP API endpoint and call `/run` with the configured API key:

```bash
export RUN_API_KEY=...
ENDPOINT=...
curl -H "x-api-key: $RUN_API_KEY" \
     -H "Content-Type: application/json" \
     -X POST "$ENDPOINT/run" \
     -d '{"from":"2025-09-30","until":"2025-09-30"}'
```

## Create state bucket

```bash
./create-state-bucket.sh stage
./create-state-bucket.sh production
# LocalStack (defaults to http://localstack:4566; override via LOCALSTACK_ENDPOINT)
./create-state-bucket.sh local
LOCALSTACK_ENDPOINT=http://localstack:4566 ./create-state-bucket.sh local
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
