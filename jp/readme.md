# PoliTopics-Data-Collection
[English Version](../readme.md)

PoliTopics-Data-Collection は、日本の国会会議録をダウンロードし、LLM フレンドリーなプロンプトチャンクに分割し、ペイロードを S3 に保存し、ファンアウトタスクの状態をすべて DynamoDB で追跡するサーバーレスデータパイプラインです。コードベースは TypeScript で記述され、AWS Lambda をターゲットとしています。Terraform モジュールはクラウドデプロイメントを定義し、LocalStack はローカルファーストのワークフローを可能にします。

## 要件

- Node.js 22+
- npm
- Docker (LocalStack)
- AWS CLI
- Terraform v1.6
- `zip` (デプロイメントバンドル作成時に必要)
- Gemini API キー

## 設定

環境変数がほとんどの動作を制御します:

- `GOOGLE_API_KEY` と `GEMINI_MAX_INPUT_TOKEN` は Gemini アクセスを設定します。
- `LLM_TASK_TABLE` はプロンプトタスクが保存される DynamoDB テーブルです。
- `RUN_API_KEY` は API Gateway のエントリーポイントを保護します。
- `AWS_REGION` はデフォルトで `ap-northeast-3` です。別のリージョンを使用する場合はオーバーライドしてください。
- `AWS_ENDPOINT_URL` はローカル開発時に LocalStack をターゲットにします (例: `http://localhost:4566`)。
- `ERROR_BUCKET` は S3 での実行ログ (`success/` および `error/` プレフィックス) を有効にします。

これらは `.env`、シェル、または AWS Lambda 設定を介して提供してください。

### Terraform ローカル実行

[../doc/jp/terraform-localstack.md](../doc/jp/terraform-localstack.md)

### Terraform コマンド (LocalStack)

LocalStack をターゲットにする場合の一般的な Terraform ワークフローのクイックリファレンス:

```bash
cd terraform
terraform init -backend-config=backends/local.hcl
terraform plan -var-file=tfvars/localstack.tfvars -out=tfplan
terraform apply "tfplan"
```

### `/run` エンドポイントの呼び出し

Terraform (stage/production または `enable_http_api = true` の LocalStack) を適用した後、HTTP API エンドポイントを取得し、設定された API キーを使用して `/run` を呼び出します:

```bash
export RUN_API_KEY=...
ENDPOINT=...
curl -H "x-api-key: $RUN_API_KEY" \
     -H "Content-Type: application/json" \
     -X POST "$ENDPOINT/run" \
     -d '{"from":"2024-12-01","until":"2024-12-15"}'
```

## ステートバケットの作成

```bash
./create-state-bucket.sh stage
./create-state-bucket.sh production
# LocalStack (デフォルトは http://localstack:4566; LOCALSTACK_ENDPOINT 経由でオーバーライド可能)
./create-state-bucket.sh local
LOCALSTACK_ENDPOINT=http://localstack:4566 ./create-state-bucket.sh local
```

## 手動インポート

```bash
./import_all.sh tfvars/stage.tfvars
```

## 可観測性

`ERROR_BUCKET` が設定されている場合、Lambda は実行メタデータを S3 に書き込みます:

- `success/` - 完了した実行
- `error/` - シリアライズされたエラーペイロード

オブジェクトキーの例:

```
success/2025-08-11T13:48:32.270Z-<uuid>.json
error/2025-08-11T14:05:12.100Z-<uuid>.json
```

クラウドラグは AWS の CloudWatch に、ローカル開発中は LocalStack のロギング出力に流れます。

## 今後のアップデート

国会 API による更新を確認し、lastModification カラムを DynamoDB に保存する。

```