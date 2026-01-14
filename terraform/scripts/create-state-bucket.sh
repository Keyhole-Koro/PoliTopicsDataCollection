#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <local|ghaTest|stage|prod>"
  exit 1
fi

ENVIRONMENT="$1"
REGION="ap-northeast-3"
LOCALSTACK_URL="${LOCALSTACK_URL:-${LOCALSTACK_ENDPOINT:-http://localstack:4566}}"
AWS_ARGS=()
export AWS_PAGER=""

case "$ENVIRONMENT" in
  local|ghaTest)
    BUCKET="politopics-data-collection-local-state"
    AWS_ARGS+=(--endpoint-url "$LOCALSTACK_URL")
    ;;
  stage)
    BUCKET="politopics-data-collection-stage-state"
    ;;
  prod)
    BUCKET="politopics-data-collection-production-state"
    ;;
  *)
    echo "Unknown environment: $ENVIRONMENT"
    echo "Usage: $0 <local|ghaTest|stage|prod>"
    exit 1
    ;;
esac

echo "Environment : $ENVIRONMENT"
echo "Bucket      : $BUCKET"
echo "Region      : $REGION"
if [ "$ENVIRONMENT" = "local" ] || [ "$ENVIRONMENT" = "ghaTest" ]; then
  echo "Endpoint    : $LOCALSTACK_URL"
fi
echo


echo "==> Checking S3 bucket exists..."

if aws "${AWS_ARGS[@]}" s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "S3 bucket already exists: $BUCKET"
else
  echo "Creating S3 bucket: $BUCKET"
  aws "${AWS_ARGS[@]}" s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION"

  echo "Enabling default encryption (AES256)..."
  aws "${AWS_ARGS[@]}" s3api put-bucket-encryption \
    --bucket "$BUCKET" \
    --server-side-encryption-configuration '{
      "Rules": [{
        "ApplyServerSideEncryptionByDefault": {
          "SSEAlgorithm": "AES256"
        }
      }]
    }'

  echo "Enabling versioning..."
  aws "${AWS_ARGS[@]}" s3api put-bucket-versioning \
    --bucket "$BUCKET" \
    --versioning-configuration Status=Enabled
fi

echo
echo "✅ S3 bucket setup completed."
