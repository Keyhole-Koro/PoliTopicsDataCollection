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

## Stage Deployment
```bash
cd terraform
terraform init -backend-config backends/stage.tfbackend
terraform plan  -var-file=tfvars/stage.tfvars
terraform apply -var-file=tfvars/stage.tfvars
```

## Production Deployment
```bash
cd terraform
terraform init -backend-config backends/production.tfbackend
terraform plan  -var-file=tfvars/production.tfvars
terraform apply -var-file=tfvars/production.tfvars
```

Remember to unset the secret export afterwards if you are on a shared shell:

```bash
unset TF_VAR_secret_environment_variables
```

## GitHub Actions Deployment

The workflow in `.github/workflows/deploy.yml` automatically runs `terraform init/plan/apply` when code is pushed to the `stage` or `prod` branches. Configure these repository secrets before enabling the workflow:

- `STAGE_AWS_ACCESS_KEY_ID` / `STAGE_AWS_SECRET_ACCESS_KEY`
- `PROD_AWS_ACCESS_KEY_ID` / `PROD_AWS_SECRET_ACCESS_KEY`
- `STAGE_RUN_API_KEY`, `PROD_RUN_API_KEY`
- `STAGE_GEMINI_API_KEY`, `PROD_GEMINI_API_KEY`

The workflow sets `TF_VAR_secret_environment_variables` from those secrets so the API keys never appear in the repository.

