#!/usr/bin/env bash
set -euo pipefail

# Run LocalStack apply for the DataCollection module (build + state bucket + import + plan/apply).

ENVIRONMENT="${1:-local}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TF_DIR="$MODULE_DIR/terraform"
STATE_SCRIPT="$TF_DIR/scripts/create-state-bucket.sh"
IMPORT_SCRIPT="$TF_DIR/scripts/import_all.sh"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd terraform
require_cmd npm
require_cmd aws

echo "==> DataCollection: build"
(cd "$MODULE_DIR" && npm ci && npm run build)

echo "==> DataCollection: create state bucket"
"$STATE_SCRIPT" "$ENVIRONMENT"

BACKEND_CONFIG="backends/local.hcl"
TFVARS_FILE="tfvars/localstack.tfvars"
if [ "$ENVIRONMENT" == "ghaTest" ]; then
  BACKEND_CONFIG="backends/ghaTest.hcl"
  TFVARS_FILE="tfvars/ghaTest.tfvars"
fi

echo "==> DataCollection: terraform init"
terraform -chdir="$TF_DIR" init -input=false -reconfigure -backend-config="$BACKEND_CONFIG"

echo "==> DataCollection: terraform import"
"$IMPORT_SCRIPT" "$ENVIRONMENT"

echo "==> DataCollection: terraform plan"
set +e
terraform -chdir="$TF_DIR" plan -detailed-exitcode -var-file="$TFVARS_FILE" -out=tfplan
PLAN_EXIT_CODE=$?
set -e

case "$PLAN_EXIT_CODE" in
  0)
    echo "No changes detected. Skipping apply."
    ;;
  2)
    echo "Changes detected. Applying tfplan..."
    terraform -chdir="$TF_DIR" apply -input=false tfplan
    ;;
  *)
    echo "Terraform plan failed with exit code $PLAN_EXIT_CODE"
    exit "$PLAN_EXIT_CODE"
    ;;
esac
