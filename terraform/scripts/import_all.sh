#!/usr/bin/env bash
set -euo pipefail

TF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TFVARS_DIR="$TF_DIR/tfvars"
ENVIRONMENT_ARG="${1:-stage}"

case "$ENVIRONMENT_ARG" in
  local)
    VAR_FILE="$TFVARS_DIR/localstack.tfvars"
    ;;
  stage)
    VAR_FILE="$TFVARS_DIR/stage.tfvars"
    ;;
  prod)
    VAR_FILE="$TFVARS_DIR/prod.tfvars"
    ;;
  *)
    if [[ -f "$ENVIRONMENT_ARG" ]]; then
      VAR_FILE="$ENVIRONMENT_ARG"
    else
      echo "Usage: $(basename "$0") [local|stage|prod]" >&2
      exit 1
    fi
    ;;
esac

if [[ ! -f "$VAR_FILE" ]]; then
  echo "Variable file not found: $VAR_FILE" >&2
  exit 1
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd terraform
require_cmd python3
require_cmd aws

eval "$(
  python3 - "$VAR_FILE" <<'PY'
import pathlib
import re
import shlex
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()

def extract(key):
  pattern = rf'(?m)^\s*{re.escape(key)}\s*=\s*(.+)$'
  match = re.search(pattern, text)
  if not match:
    return ""
  raw = match.group(1).strip()
  if "#" in raw:
    raw = raw.split("#", 1)[0].strip()
  if raw.startswith('"') and raw.endswith('"'):
    return raw[1:-1]
  lowered = raw.lower()
  if lowered == "null":
    return ""
  if lowered in ("true", "false"):
    return lowered
  return raw

values = {
  "SERVICE_NAME": extract("service_name"),
  "ENVIRONMENT": extract("environment"),
  "PROMPT_BUCKET_NAME": extract("prompt_bucket_name"),
  "ERROR_BUCKET_NAME": extract("error_bucket_name"),
  "LLM_TASK_TABLE_NAME": extract("llm_task_table_name"),
  "ENABLE_HTTP_API": extract("enable_http_api") or "true",
  "API_ROUTE_KEY": extract("api_route_key") or "POST /run",
  "AWS_REGION": extract("aws_region"),
  "LAMBDA_FUNCTION_NAME": extract("lambda_function_name"),
}

for key, value in values.items():
  if key == "ENABLE_HTTP_API":
    print(f"{key}={value or 'true'}")
  else:
    print(f'{key}={shlex.quote(value)}')
PY
)"

for required in SERVICE_NAME ENVIRONMENT PROMPT_BUCKET_NAME LLM_TASK_TABLE_NAME AWS_REGION; do
  if [[ -z "${!required:-}" ]]; then
    echo "Missing required value for $required (check $VAR_FILE)" >&2
    exit 1
  fi
done

TF_CMD=(terraform -chdir="$TF_DIR")
NAME_PREFIX="${SERVICE_NAME}-${ENVIRONMENT}"
if [[ -z "${LAMBDA_FUNCTION_NAME:-}" ]]; then
  LAMBDA_FUNCTION_NAME="${NAME_PREFIX}-data-collection-fn"
fi
LAMBDA_ROLE_NAME="${NAME_PREFIX}-data-collection-lambda-role"
LAMBDA_POLICY_NAME="${NAME_PREFIX}-dynamodb-tasks"
EVENT_RULE_NAME="${NAME_PREFIX}-data-collection-schedule"
EVENT_TARGET_ID="${NAME_PREFIX}-lambda"
HTTP_API_NAME="${NAME_PREFIX}-http"
STAGE_NAME='$default'

export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-$AWS_REGION}"

ACCOUNT_ID="$(aws sts get-caller-identity --query 'Account' --output text)"
if [[ -z "$ACCOUNT_ID" || "$ACCOUNT_ID" == "None" ]]; then
  echo "Unable to determine AWS account ID" >&2
  exit 1
fi

S3_WRITE_POLICY_NAME="${NAME_PREFIX}-s3-writes"
LAMBDA_POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${LAMBDA_POLICY_NAME}"
S3_WRITE_POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${S3_WRITE_POLICY_NAME}"
BASIC_EXEC_POLICY_ARN="arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"


run_import() {
  local address="$1"
  local identifier="$2"
  if [[ -z "$identifier" || "$identifier" == "None" ]]; then
    echo "Skipping $address because identifier is empty" >&2
    return
  fi

  (
    cd "$TF_DIR"

    if terraform state show "$address" >/dev/null 2>&1; then
      echo "skip   -> $address (already in state)"
      return
    fi

    echo "import -> $address :: $identifier"
    set +e
    import_output="$(terraform import -var-file="$VAR_FILE" -no-color "$address" "$identifier" 2>&1)"
    import_status=$?
    set -e
    if [[ $import_status -ne 0 ]]; then
      if echo "$import_output" | grep -q "Cannot import non-existent remote object"; then
        echo "skip   -> $address (missing remote object)" >&2
        return
      fi
      if echo "$import_output" | grep -q "Configuration for import target does not exist"; then
        echo "skip   -> $address (missing configuration)" >&2
        return
      fi
      if echo "$import_output" | grep -q "couldn't find resource"; then
        echo "skip   -> $address (missing resource)" >&2
        return
      fi
      echo "$import_output" >&2
      exit "$import_status"
    fi
  )
}

run_import "module.service.module.buckets.aws_s3_bucket.prompt" "$PROMPT_BUCKET_NAME"
run_import "module.service.module.buckets.aws_s3_bucket_versioning.prompt" "$PROMPT_BUCKET_NAME"
run_import "module.service.module.buckets.aws_s3_bucket_server_side_encryption_configuration.prompt" "$PROMPT_BUCKET_NAME"
run_import "module.service.module.buckets.aws_s3_bucket_public_access_block.prompt" "$PROMPT_BUCKET_NAME"

run_import "module.service.module.buckets.aws_s3_bucket.error" "$ERROR_BUCKET_NAME"
run_import "module.service.module.buckets.aws_s3_bucket_public_access_block.error" "$ERROR_BUCKET_NAME"

run_import "module.service.module.tasks_table.aws_dynamodb_table.this" "$LLM_TASK_TABLE_NAME"

run_import "module.service.module.lambda.aws_iam_role.lambda" "$LAMBDA_ROLE_NAME"
run_import "module.service.module.lambda.aws_iam_policy.dynamodb_tasks" "$LAMBDA_POLICY_ARN"
run_import "module.service.module.lambda.aws_iam_role_policy_attachment.dynamodb_tasks" "${LAMBDA_ROLE_NAME}/${LAMBDA_POLICY_ARN}"
run_import "module.service.module.lambda.aws_iam_role_policy_attachment.basic_execution" "${LAMBDA_ROLE_NAME}/${BASIC_EXEC_POLICY_ARN}"
run_import "module.service.module.lambda.aws_iam_policy.s3_write[0]" "$S3_WRITE_POLICY_ARN"
run_import "module.service.module.lambda.aws_iam_role_policy_attachment.s3_write[0]" "${LAMBDA_ROLE_NAME}/${S3_WRITE_POLICY_ARN}"

run_import "module.service.module.lambda.aws_lambda_function.this" "$LAMBDA_FUNCTION_NAME"
run_import "module.service.module.lambda.aws_cloudwatch_event_rule.schedule" "$EVENT_RULE_NAME"
run_import "module.service.module.lambda.aws_cloudwatch_event_target.schedule" "${EVENT_RULE_NAME}/${EVENT_TARGET_ID}"
run_import "module.service.module.lambda.aws_lambda_permission.allow_events" "${LAMBDA_FUNCTION_NAME}/AllowEventBridgeInvoke"

if [[ "${ENABLE_HTTP_API}" == "true" || "${ENABLE_HTTP_API}" == "True" ]]; then
  HTTP_API_ID="$(
    aws apigatewayv2 get-apis \
      --query "Items[?Name=='${HTTP_API_NAME}'] | [0].ApiId" \
      --output text
  )"

  if [[ -z "$HTTP_API_ID" || "$HTTP_API_ID" == "None" ]]; then
    echo "Unable to find HTTP API named ${HTTP_API_NAME}" >&2
    exit 1
  fi

  INTEGRATION_ID="$(aws apigatewayv2 get-integrations --api-id "$HTTP_API_ID" --query 'Items[0].IntegrationId' --output text)"
  ROUTE_ID="$(aws apigatewayv2 get-routes --api-id "$HTTP_API_ID" --query "Items[?RouteKey==\`${API_ROUTE_KEY}\`].RouteId" --output text)"
  if [[ -z "$ROUTE_ID" || "$ROUTE_ID" == "None" ]]; then
    echo "Unable to find route ${API_ROUTE_KEY} on API ${HTTP_API_ID}" >&2
    exit 1
  fi

  run_import "module.service.module.lambda.aws_apigatewayv2_api.http[0]" "$HTTP_API_ID"
  run_import "module.service.module.lambda.aws_apigatewayv2_integration.lambda[0]" "${HTTP_API_ID}/${INTEGRATION_ID}"
  run_import "module.service.module.lambda.aws_apigatewayv2_route.lambda[0]" "${HTTP_API_ID}/${ROUTE_ID}"
  run_import "module.service.module.lambda.aws_apigatewayv2_stage.default[0]" "${HTTP_API_ID}/${STAGE_NAME}"
  run_import "module.service.module.lambda.aws_lambda_permission.allow_http_api[0]" "${LAMBDA_FUNCTION_NAME}/AllowHttpApiInvoke"
fi

echo "Terraform import operations complete."
