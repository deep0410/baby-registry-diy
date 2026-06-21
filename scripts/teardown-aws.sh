#!/usr/bin/env bash
#
# Removes everything setup-aws.sh created. DESTRUCTIVE — deletes the table,
# empties + deletes the bucket, and removes the IAM user.
#
# Usage:  ./scripts/teardown-aws.sh
#
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
TABLE="${DYNAMODB_TABLE:-baby-registry}"
IAM_USER="${IAM_USER:-baby-registry-app}"

command -v aws >/dev/null 2>&1 || { echo "❌ AWS CLI not found."; exit 1; }
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${S3_BUCKET:-baby-registry-images-${ACCOUNT_ID}}"

echo "This will DELETE:"
echo "  - DynamoDB table : $TABLE"
echo "  - S3 bucket      : $BUCKET (and all its contents)"
echo "  - IAM user       : $IAM_USER (and its keys/policy)"
read -r -p "Type 'delete' to continue: " CONFIRM
[ "$CONFIRM" = "delete" ] || { echo "Aborted."; exit 1; }

echo "🟡 Deleting DynamoDB table..."
aws dynamodb delete-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1 || echo "  (not found)"

echo "🟡 Emptying + deleting S3 bucket..."
if aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  aws s3 rm "s3://$BUCKET" --recursive >/dev/null 2>&1 || true
  aws s3api delete-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null 2>&1 || true
else
  echo "  (not found)"
fi

echo "🟡 Removing IAM user..."
if aws iam get-user --user-name "$IAM_USER" >/dev/null 2>&1; then
  for k in $(aws iam list-access-keys --user-name "$IAM_USER" --query 'AccessKeyMetadata[].AccessKeyId' --output text); do
    aws iam delete-access-key --user-name "$IAM_USER" --access-key-id "$k" || true
  done
  aws iam delete-user-policy --user-name "$IAM_USER" --policy-name baby-registry-access >/dev/null 2>&1 || true
  aws iam delete-user --user-name "$IAM_USER" >/dev/null 2>&1 || true
else
  echo "  (not found)"
fi

echo "✅ Teardown complete."
