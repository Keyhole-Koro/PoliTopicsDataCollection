# PoliTopics Data Collection
[English Version](../readme.md)

国会会議録を取得し、raw payload を S3 に保存し、ingested タスクを DynamoDB に登録するサーバーレスの収集サービスです。TypeScript + AWS Lambda で動作し、Terraform と LocalStack でローカルから本番まで同じフローを使えます。

## アーキテクチャ

```mermaid
flowchart LR
  %% ========== Data Collection ==========
  subgraph DC[PoliTopicsDataCollection / 収集サービス]
    IngestSchedule["EventBridge (Cron)<br/>取得スケジュール"]
    IngestLambda["AWS Lambda (Node.js)<br/>IngestLambda"]
    ArtifactBucket[(Amazon S3<br/>LLMArtifactsBucket<br/>raw + attached assets)]
    TaskTable[(DynamoDB<br/>TaskTable: llm_task_table)]
  end

  NationalDietAPI["外部<br/>国会議事録API<br/>(National Diet API)"]

  IngestSchedule -->|トリガー| IngestLambda
  IngestLambda -->|会議録を取得| NationalDietAPI
  IngestLambda -->|raw payload + assets を保存| ArtifactBucket
  IngestLambda -->|ingested タスクを登録 (raw_url/raw_hash)| TaskTable
```

メモ
- スケジューラは会議後に API 反映が遅れるため、21日前から当日までをクエリ。
- raw payload は S3、タスクは DynamoDB、通知は Discord Webhook。
- LocalStack でローカル動作、本番/ステージは同じ Lambda バンドルをデプロイ。

## コマンド
- インストール: `npm install`
- LocalStack リソース確認/作成: `npm run ensure:localstack`
- テスト (LocalStack): `npm test` (`APP_ENVIRONMENT=localstackTest`, `pretest` でリソース適用)
- テスト (gha): `npm run test:gha`
- ビルド: `npm run build`

## 環境変数
- `APP_ENVIRONMENT` (`local`|`stage`|`prod`|`ghaTest`|`localstackTest`)
- `RUN_API_KEY`
- `LLM_TASK_TABLE`
- `PROMPT_BUCKET` (raw payload + attached assets を保存する S3)
- `ERROR_BUCKET` (任意の実行ログ)
- `DISCORD_WEBHOOK_ERROR`, `DISCORD_WEBHOOK_WARN`, `DISCORD_WEBHOOK_BATCH`
- AWS: `AWS_REGION` (デフォルト `ap-northeast-3`), LocalStack 用の `AWS_ENDPOINT_URL`

ヒント: リポジトリルートで `source ../scripts/export_test_env.sh` を実行すると、LocalStack 用の主要デフォルトが一括で設定されます。

## ローカル実行と呼び出し
1) LocalStack を起動 (リポジトリルートの `docker-compose.yml`)。
2) `npm run ensure:localstack`
3) `/run` を呼び出す:
```bash
curl -H "x-api-key: $RUN_API_KEY" \
     -H "Content-Type: application/json" \
     -X POST "$API_ENDPOINT/run" \
     -d '{"from":"2025-01-01","until":"2025-01-05"}'
```

## Terraform
- LocalStack 手順: `doc/jp/terraform-localstack.md`
- 典型フロー:
```bash
cd terraform
terraform init -backend-config=backends/local.hcl
terraform plan -var-file=tfvars/localstack.tfvars -out=tfplan
terraform apply tfplan
```

## オブザーバビリティ
- `ERROR_BUCKET` 設定時は S3 に実行ログ:
  - `success/<timestamp>-<uuid>.json`
  - `error/<timestamp>-<uuid>.json`
- Lambda の CloudWatch ログ、ローカルでは LocalStack のログを参照。
