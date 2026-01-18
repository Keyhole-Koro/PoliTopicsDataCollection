# Terraform + LocalStack クイックスタート
[English Version](../../doc/terraform-localstack.md)

PoliTopics スタック全体を Terraform を使用して LocalStack にデプロイし、Lambda、S3、DynamoDB タスクワークフローをエンドツーエンドで実行します (以前の `src/local_invoke.ts` ヘルパーはなくなりました)。ステージ/本番の手順は他の場所にあります。このドキュメントは純粋にローカルワークフロー用です。

## 前提条件

- Terraform 1.8.x (`.terraform-version` と一致)
- Node.js 22+ (npm 使用) (Lambda バンドル + スクリプト)
- Docker + LocalStack (`npm run local:up` 経由で実行中)
- AWS CLI v2 (オプション、以下のデバッグスニペットで使用)

> LocalStack のコミュニティイメージで Lambda 関数を実行するには、Docker-in-Docker または `LAMBDA_EXECUTOR=local` 設定が必要です。提供されている `docker-compose.yml` はすでに `LAMBDA_EXECUTOR=local` をエクスポートしています。スタックをカスタマイズする場合は、そのフラグを保持する (または使用可能な Docker ソケットを公開する) 必要があります。そうしないと、`terraform apply` 中に Lambda の作成が `ConnectionRefusedError` で失敗します。

## シークレットと環境変数

機密性の高い Lambda 環境変数 (例: `RUN_API_KEY`, `GEMINI_API_KEY`) を tfvars ファイルにコミットしないでください。Terraform を実行する前に `TF_VAR_secret_environment_variables` 環境変数を介して提供してください:

```bash
export TF_VAR_secret_environment_variables='{"RUN_API_KEY":"<run-key>","GEMINI_API_KEY":"<gemini-key>"}'
```

共有シェルを使用している場合は、後で設定を解除してください:

```bash
unset TF_VAR_secret_environment_variables
```

## Terraform + LocalStack フロー

1. **Lambda バンドルと依存関係レイヤーをビルドまたはリフレッシュ**して、Terraform が期待されるアーティファクトを確認できるようにします:

   ```bash
   # LocalStack 無料枠はカスタムレイヤーをブロックします。このスクリプトは node_modules を Lambda コードの隣にコピーし、
   # ダミーのレイヤーアーティファクトを残すため、Terraform は2つのコードパス (リモート vs ローカル) を必要としません。
   npm install
   npm run build:local
   ```

   これにより、`dist/lambda_handler.zip` (Lambda 関数) と `dist/lambda_layer.zip` (Node.js 依存関係) が生成されます。

2. **Terraform 設定ディレクトリに切り替えます**:

   ```bash
   cd terraform
   ```

3. **LocalStack バックエンド設定で Terraform を初期化します**:

   ```bash
   export ENV=local
   export TF_VAR_gemini_api_key="fake"
   terraform init -backend-config=backends/local.hcl
   ```

   > 以前にリモート/S3 バックエンドを指していましたか？ `-reconfigure` を追加して、`plan`/`apply` を実行する前に Terraform が以前のバックエンド選択を忘れるようにします。

4. **LocalStack tfvars プロファイルを使用して変更を計画します**:

   ```bash
   terraform plan -var-file="tfvars/localstack.tfvars" -out=tfplan
   ```

   `tfplan` に保存することで、apply の再現性が維持されます。

> LocalStack のコミュニティイメージにはまだ API Gateway v2 HTTP API エミュレーションがありません。`tfvars/localstack.tfvars` プロファイルは `enable_http_api = false` を設定しているため、Terraform はローカルで API Gateway リソースをスキップします。HTTP API をデプロイするには LocalStack Pro または AWS を使用してください。

5. **計画された変更を適用します**:

   ```bash
   terraform apply "tfplan"
   ```

   保存されたプランをスキップして `terraform apply -var-file="tfvars/localstack.tfvars"` を実行することもできます。
