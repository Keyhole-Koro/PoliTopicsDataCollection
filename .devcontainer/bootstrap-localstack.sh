#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/workspaces/app"
cd "$ROOT_DIR"

pnpm install
pnpm build
npm run build

./scripts/create-state-bucket.sh local

cd terraform
terraform init -backend-config=backends/local.hcl
terraform plan -var-file=tfvars/localstack.tfvars -out=tfplan
terraform apply "tfplan"
