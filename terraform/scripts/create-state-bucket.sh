#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <stage|production|local>"
  exit 1
fi

ENV="$1"
REGION="ap-northeast-3"
LOCALSTACK_ENDPOINT="${LOCALSTACK_ENDPOINT:-http://localstack:4566}"
AWS_ARGS=()

case "$ENV" in
  stage)
    BUCKET="politopics-data-collection-stage-state"
    ;;
  production)
    BUCKET="politopics-data-collection-production-state"
    ;;
  local)
    BUCKET="politopics-data-collection-local-state-bucket"
    AWS_ARGS+=(--endpoint-url "$LOCALSTACK_ENDPOINT")
    ;;
  *)
    echo "Unknown environment: $ENV"
    exit 1
    ;;
esac

echo "Environment : $ENV"
echo "Bucket      : $BUCKET"
echo "Region      : $REGION"
if [ "$ENV" = "local" ]; then
  echo "Endpoint    : $LOCALSTACK_ENDPOINT"
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
