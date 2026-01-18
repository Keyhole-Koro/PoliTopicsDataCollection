# スクリプトと使用法 (PoliTopicsDataCollection)
[English Version](../../doc/scripts_and_usage.md)

このドキュメントでは、DataCollection モジュールの実行可能なスクリプトと一般的なワークフローをリストします。
パスは `PoliTopicsDataCollection` からの相対パスです。

## NPM スクリプト
- `npm run build`: Lambda バンドルを `dist/` にビルドします (`scripts/build-lambda.js` を実行)。
- `npm run postbuild`: ビルド出力内の TS パスエイリアスを書き換えます。
- `npm run test`: `APP_ENVIRONMENT=localstackTest` で Jest を実行します (LocalStack を想定)。
- `npm run test:gha`: `APP_ENVIRONMENT=ghaTest` で Jest を実行します。
- `npm run ensure:localstack`: LocalStack リソースを検証し、不足している場合は作成します。
- `npm run pretest`: `ensure:localstack` と同じです。

## ヘルパースクリプト
- `scripts/build-lambda.js`: `dist/` をクリーンアップし、TS をコンパイルし、パッケージメタデータをコピーし、本番依存関係をインストールします。
- `scripts/ensure-localstack.sh`: LocalStack のバケット/テーブル/Lambda を確認します。`--check-only` と環境引数 (デフォルト: `DATACOLLECTION_LOCALSTACK_ENV` または `local`) をサポートします。
- `scripts/localstack_apply.sh`: ビルド、ステートバケットの作成、リソースのインポート、および LocalStack または ghaTest 用の Terraform plan/apply を実行します。
- `terraform/scripts/create-state-bucket.sh <local|ghaTest|stage|prod>`: Terraform ステートバケットを作成/検証します。
- `terraform/scripts/import_all.sh <local|ghaTest|stage|prod>`: 既存のリソースを Terraform ステートにインポートします。

## ユースケース

### LocalStack に対してテストを実行する
1. LocalStack を起動します (ルート `docker-compose.yml` 経由)。
2. リソースを確認します:

```bash
npm run ensure:localstack
```

3. テストを実行します:

```bash
npm run test
```

### LocalStack インフラをブートストラップする
```bash
bash scripts/localstack_apply.sh local
```

オプションの検証のみ:

```bash
bash scripts/ensure-localstack.sh --check-only
```

### デプロイ用の Lambda アーティファクトをビルドする
```bash
npm run build
```

デプロイには `dist/` の内容を使用します。

## 関連ドキュメント
- `doc/jp/terraform-localstack.md`
