# Terraform Deployment

## Prerequisites
- Terraform 1.8.x (matching `.terraform-version`)
- AWS credentials with permissions to manage S3, SQS, IAM, and Lambda in `ap-northeast-3`
- Backend S3 bucket and DynamoDB table (if used) already created and referenced in `terraform/backends/*.tfbackend`

## Secrets and Environment Variables
Sensitive Lambda environment variables (e.g., `RUN_API_KEY`, `GEMINI_API_KEY`) should **not** be committed to tfvars files. Supply them via the `TF_VAR_secret_environment_variables` environment variable before running Terraform:

```bash
export TF_VAR_secret_environment_variables='{"RUN_API_KEY":"<run-key>","GEMINI_API_KEY":"<gemini-key>"}'
```

Stage and production tfvars files already provide the non-sensitive defaults (e.g., `GEMINI_MAX_INPUT_TOKEN`). Add additional keys to the JSON blob as needed.

## Build Lambda Artifact

Run this once before planning/applying so Terraform can package the local build:

```bash
npm install
npm run build
```

## Stage Deployment
```bash
cd terraform
terraform init -backend-config backends/stage.tfbackend
terraform plan  -var-file tfvars/stage.tfvars
terraform apply -var-file tfvars/stage.tfvars
```

## Production Deployment
```bash
cd terraform
terraform init -backend-config backends/production.tfbackend
terraform plan  -var-file tfvars/production.tfvars
terraform apply -var-file tfvars/production.tfvars
```

Remember to unset the secret export afterwards if you are on a shared shell:

```bash
unset TF_VAR_secret_environment_variables
```

### Reusing an Existing Prompt Queue

Set `-var="create_prompt_queue=false"` and provide either `existing_prompt_queue_url`/`existing_prompt_queue_arn` or ensure the queue name you supply in `prompt_queue_name` already exists so Terraform can discover it. This is handy when a shared queue is provisioned separately.

## LocalStack Quickstart

Use this workflow when you want to deploy the stack to LocalStack for end-to-end testing without touching real AWS accounts.

1. Build the Lambda artifact so Terraform can package the compiled code:
   ```bash
   npm run build
   ```
2. Start (or confirm) LocalStack via Docker Compose:
   ```bash
   npm run local:up
   ```
3. Initialise Terraform from the repo root; `-chdir=./terraform` plays nicely with Windows shells:
   ```bash
   terraform -chdir=./terraform init -backend=false
   ```
4. Apply the LocalStack variable profile to stand up the resources:
   ```bash
   terraform -chdir=./terraform apply -var-file=tfvars/localstack.tfvars
   ```
   You can combine additional flags such as `-var="lambda_package_dir=../dist"` or `-var="create_prompt_queue=true"` to control packaging and queue creation (the defaults already create the queue and use `../dist`).
5. (Optional) Run integration tests once the queue exists:
   ```bash
   AWS_ENDPOINT_URL=http://127.0.0.1:4566 npm test -- sqs.localstack
   ```

Terraform writes `terraform.tfstate` inside `./terraform` when the backend is disabled. Remove that file to reset all state, then destroy the stack when you are finished:

```bash
terraform -chdir=./terraform destroy -var-file=tfvars/localstack.tfvars
```

## GitHub Actions Deployment

The workflow in `.github/workflows/deploy.yml` automatically runs `terraform init/plan/apply` when code is pushed to the `stage` or `prod` branches. Configure these repository secrets before enabling the workflow:

- `STAGE_AWS_ACCESS_KEY_ID` / `STAGE_AWS_SECRET_ACCESS_KEY`
- `PROD_AWS_ACCESS_KEY_ID` / `PROD_AWS_SECRET_ACCESS_KEY`
- `STAGE_RUN_API_KEY`, `PROD_RUN_API_KEY`
- `STAGE_GEMINI_API_KEY`, `PROD_GEMINI_API_KEY`

The workflow sets `TF_VAR_secret_environment_variables` from those secrets so the API keys never appear in the repository.


