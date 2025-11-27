# Terraform + LocalStack Quickstart

Deploy the complete PoliTopics stack into LocalStack with Terraform to exercise the Lambda, SQS, S3, and DynamoDB workflows end-to-end (the previous `src/local_invoke.ts` helper is gone). Stage/production instructions live elsewhere—this document is purely for the local workflow.

## Prerequisites

- Terraform 1.8.x (matching `.terraform-version`)
- Node.js 18+ with npm (Lambda bundle + scripts)
- Docker + LocalStack running via `npm run local:up`
- AWS CLI v2 (optional, used by the debugging snippets below)

> LocalStack's community image needs either Docker-in-Docker or the `LAMBDA_EXECUTOR=local` setting to run Lambda functions. The provided `docker-compose.yml` already exports `LAMBDA_EXECUTOR=local`; if you customise the stack, keep that flag (or expose a usable Docker socket) or Lambda creation will fail with `ConnectionRefusedError` during `terraform apply`.

## Secrets and Environment Variables

Never commit sensitive Lambda env vars (e.g., `RUN_API_KEY`, `GEMINI_API_KEY`) to tfvars files. Provide them through the `TF_VAR_secret_environment_variables` environment variable before running Terraform:

```bash
export TF_VAR_secret_environment_variables='{"RUN_API_KEY":"<run-key>","GEMINI_API_KEY":"<gemini-key>"}'
```

Unset it afterwards if you are on a shared shell:

```bash
unset TF_VAR_secret_environment_variables
```

## Terraform + LocalStack Flow

1. **Build or refresh the Lambda bundle and dependency layer** so Terraform sees the expected artifacts:

   ```bash
   # LocalStack free tier blocks custom layers; this script copies node_modules next to the Lambda code
   # and leaves a dummy layer artifact so Terraform does not need two code paths (remote vs local).
   npm install
   npm run build:local
   ```

   This produces `dist/lambda_handler.zip` (Lambda function) and `dist/lambda_layer.zip` (Node.js dependencies).

2. **Switch into the Terraform configuration directory** :

   ```bash
   cd terraform
   ```

3. **Initialise Terraform with the LocalStack backend config**:

   ```bash
   export ENV=local
   export TF_VAR_gemini_api_key="fake"
   terraform init -backend-config=backends/local.hcl
   ```

   > Previously pointed at the remote/S3 backend? Append `-reconfigure` so Terraform forgets the earlier backend selection before you run `plan`/`apply`.

4. **Plan the changes** with the LocalStack tfvars profile:

   ```bash
   terraform plan -var-file="tfvars/localstack.tfvars" -out=tfplan
   ```

   Saving to `tfplan` keeps the apply reproducible.

   > LocalStack's community image still lacks API Gateway v2 HTTP API emulation. The `tfvars/localstack.tfvars` profile sets `enable_http_api = false` so Terraform skips those resources locally. You'll still get the Lambda + SQS + S3 stack, and you can re-enable the HTTP API when targeting AWS or LocalStack Pro.

5. **Apply the planned changes**:

   ```bash
   terraform apply "tfplan"
   ```

   You can also skip the saved plan and run `terraform apply -var-file="tfvars/localstack.tfvars"`.
