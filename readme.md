# PoliTopics Data Collection
[日本語版](./jp/readme.md)

Serverless ingestion for the National Diet: fetch records, store raw payloads in S3, and register ingested tasks in DynamoDB. Built with TypeScript on AWS Lambda, provisioned by Terraform, and runnable on LocalStack.

## Architecture

```mermaid
flowchart LR
  %% ========== Data Collection ==========
  subgraph DC[PoliTopicsDataCollection / Ingestion Service]
    IngestSchedule["EventBridge (Cron)<br/>IngestSchedule"]
    IngestLambda["AWS Lambda (Node.js)<br/>IngestLambda"]
    ArtifactBucket[(Amazon S3<br/>LLMArtifactsBucket<br/>raw + attached assets)]
    TaskTable[(DynamoDB<br/>TaskTable: llm_task_table)]
  end

  NationalDietAPI["External<br/>NationalDietAPI<br/>(国会議事録API)"]

  IngestSchedule -->|Triggers| IngestLambda
  IngestLambda -->|Fetches Data| NationalDietAPI
  IngestLambda -->|Stores Raw Payload + Assets| ArtifactBucket
  IngestLambda -->|Registers ingested task (raw_url/raw_hash)| TaskTable
```

Notes
- Scheduler queries from 21 days ago to today because the Diet API publishes with a short lag after meetings.
- When a range is requested (cron/HTTP), the service splits it into 7-day windows, requests `maximumRecords=10`, and waits ~15s between National Diet API calls.
- Raw payloads live in S3; task metadata in DynamoDB; Discord webhooks for error/warn/batch.
- Local-first via LocalStack; same Lambda bundle deploys to stage/prod.

## Commands
- Install: `npm install`
- Ensure LocalStack resources: `npm run ensure:localstack`
- Test (LocalStack): `npm test` (`APP_ENVIRONMENT=localstackTest`, `pretest` applies resources)
- Test (gha): `npm run test:gha`
- Build Lambda bundle: `npm run build`

## Environment
- `APP_ENVIRONMENT` (`local`|`stage`|`prod`|`ghaTest`|`localstackTest`)
- `RUN_API_KEY`
- `LLM_TASK_TABLE`
- `PROMPT_BUCKET` (S3 for raw payloads + attached assets)
- `ERROR_BUCKET` (optional run logs)
- `DISCORD_WEBHOOK_ERROR`, `DISCORD_WEBHOOK_WARN`, `DISCORD_WEBHOOK_BATCH`
- AWS: `AWS_REGION` (default `ap-northeast-3`), `AWS_ENDPOINT_URL` for LocalStack

Tip: `source ../scripts/export_test_env.sh` from the repo root to load common LocalStack defaults.

## Local run & invoke
1) Start LocalStack (root `docker-compose.yml`).
2) `npm run ensure:localstack`
3) Invoke `/run` with your key:
```bash
curl -H "x-api-key: $RUN_API_KEY" \
     -H "Content-Type: application/json" \
     -X POST "$API_ENDPOINT/run" \
     -d '{"from":"2025-01-01","until":"2025-01-05"}'
```

## Terraform
- LocalStack guide: `doc/terraform-localstack.md`
- Typical flow:
```bash
cd terraform
terraform init -backend-config=backends/local.hcl
terraform plan -var-file=tfvars/localstack.tfvars -out=tfplan
terraform apply tfplan
```

## Observability
- S3 run logs when `ERROR_BUCKET` is set:
  - `success/<timestamp>-<uuid>.json`
  - `error/<timestamp>-<uuid>.json`
- CloudWatch for Lambda; LocalStack logs during local runs.
