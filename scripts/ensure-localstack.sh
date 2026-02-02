#!/usr/bin/env bash
set -euo pipefail

# Ensures LocalStack resources for DataCollection exist before running tests.
# Resource checks live here; root-level verify wraps this script.

ENVIRONMENT="${DATACOLLECTION_LOCALSTACK_ENV:-local}"
CHECK_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --check-only|--verify-only)
      CHECK_ONLY=true
      ;;
    *)
      ENVIRONMENT="$arg"
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APPLY_SCRIPT="$MODULE_DIR/scripts/localstack_apply.sh"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd aws

if [[ ! -x "$APPLY_SCRIPT" ]]; then
  echo "Apply script not found: $APPLY_SCRIPT" >&2
  exit 1
fi

LOCALSTACK_URL="${LOCALSTACK_URL:-http://localstack:4566}"
AWS_REGION="${AWS_REGION:-ap-northeast-3}"
AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION
export AWS_PAGER=""
AWS_ARGS=(--endpoint-url "$LOCALSTACK_URL" --region "$AWS_REGION")

failures=0

check_bucket() {
  local name="$1"
  if aws "${AWS_ARGS[@]}" s3api head-bucket --bucket "$name" >/dev/null 2>&1; then
    echo "[OK] s3 bucket: $name"
  else
    echo "[MISSING] s3 bucket: $name"
    failures=$((failures + 1))
  fi
}

check_table() {
  local name="$1"
  if aws "${AWS_ARGS[@]}" dynamodb describe-table --table-name "$name" >/dev/null 2>&1; then
    echo "[OK] dynamodb table: $name"
  else
    echo "[MISSING] dynamodb table: $name"
    failures=$((failures + 1))
  fi
}

check_lambda() {
  local name="$1"
  if aws "${AWS_ARGS[@]}" lambda get-function --function-name "$name" >/dev/null 2>&1; then
    echo "[OK] lambda: $name"
  else
    echo "[MISSING] lambda: $name"
    failures=$((failures + 1))
  fi
}

echo "[ensure-localstack] Checking DataCollection LocalStack resources at $LOCALSTACK_URL"
check_bucket "politopics-llm-artifacts-local"
check_bucket "politopics-data-collection-errors-local"
check_bucket "politopics-data-collection-local-state"
check_table "politopics-llm-tasks-local"
check_lambda "poliopics-datacollection-local"

if [[ $failures -eq 0 ]]; then
  echo "[ensure-localstack] Resources already present."
  exit 0
fi

if $CHECK_ONLY; then
  echo "[ensure-localstack] Missing ${failures} DataCollection resource(s)."
  exit 1
fi

echo "[ensure-localstack] Resources missing. Running apply ($ENVIRONMENT)..."
exec "$APPLY_SCRIPT" "$ENVIRONMENT"
