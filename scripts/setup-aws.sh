#!/usr/bin/env bash
#
# Provisions everything this app needs in YOUR AWS account and writes .env.local:
#   - DynamoDB table (on-demand) with TTL enabled
#   - private S3 bucket with upload CORS
#   - IAM user + scoped access key
#   - .env.local with all values filled in (including a random SESSION_SECRET)
#
# Prerequisites: AWS CLI installed and configured (`aws configure`), plus openssl.
#
# Usage:
#   ./scripts/setup-aws.sh
#
# Optional overrides (env vars):
#   AWS_REGION       (default: us-east-1)
#   DYNAMODB_TABLE   (default: baby-registry)
#   S3_BUCKET        (default: baby-registry-images-<accountId>)
#   IAM_USER         (default: baby-registry-app)
#   ADMIN_USERNAME   (default: admin)
#   ADMIN_PASSWORD   (default: a random one is generated and printed)
#
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
TABLE="${DYNAMODB_TABLE:-baby-registry}"
IAM_USER="${IAM_USER:-baby-registry-app}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"

command -v aws >/dev/null 2>&1 || { echo "❌ AWS CLI not found. Install: https://aws.amazon.com/cli/"; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "❌ openssl not found."; exit 1; }

echo "🔎 Checking AWS identity..."
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${S3_BUCKET:-baby-registry-images-${ACCOUNT_ID}}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(openssl rand -base64 12 | tr -d '/+=' )}"

echo "   Account : $ACCOUNT_ID"
echo "   Region  : $REGION"
echo "   Table   : $TABLE"
echo "   Bucket  : $BUCKET"
echo "   IAM user: $IAM_USER"
echo

# ---------------- DynamoDB ----------------
if aws dynamodb describe-table --table-name "$TABLE" --region "$REGION" >/dev/null 2>&1; then
  echo "✅ DynamoDB table '$TABLE' already exists."
else
  echo "🟡 Creating DynamoDB table '$TABLE'..."
  aws dynamodb create-table --table-name "$TABLE" \
    --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST --region "$REGION" >/dev/null
  echo "   waiting for it to become active..."
  aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"
fi
echo "🟡 Enabling TTL on 'ttl'..."
aws dynamodb update-time-to-live --table-name "$TABLE" --region "$REGION" \
  --time-to-live-specification "Enabled=true,AttributeName=ttl" >/dev/null 2>&1 \
  && echo "✅ TTL enabled." || echo "ℹ️  TTL already enabled."

# ---------------- S3 ----------------
if aws s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1; then
  echo "✅ S3 bucket '$BUCKET' already exists."
else
  echo "🟡 Creating S3 bucket '$BUCKET'..."
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  else
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  fi
fi
echo "🟡 Applying upload CORS..."
aws s3api put-bucket-cors --bucket "$BUCKET" --region "$REGION" --cors-configuration '{
  "CORSRules":[{"AllowedHeaders":["*"],"AllowedMethods":["PUT","GET"],"AllowedOrigins":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3000}]
}'
echo "✅ Bucket ready (stays private; images are served via signed URLs)."

# ---------------- IAM ----------------
POLICY_JSON=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Dynamo",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem","dynamodb:PutItem","dynamodb:UpdateItem","dynamodb:DeleteItem","dynamodb:Query","dynamodb:Scan"],
      "Resource": "arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${TABLE}"
    },
    {
      "Sid": "S3",
      "Effect": "Allow",
      "Action": ["s3:PutObject","s3:GetObject"],
      "Resource": "arn:aws:s3:::${BUCKET}/*"
    }
  ]
}
JSON
)

if ! aws iam get-user --user-name "$IAM_USER" >/dev/null 2>&1; then
  echo "🟡 Creating IAM user '$IAM_USER'..."
  aws iam create-user --user-name "$IAM_USER" >/dev/null
fi
echo "🟡 Attaching scoped policy..."
aws iam put-user-policy --user-name "$IAM_USER" \
  --policy-name baby-registry-access --policy-document "$POLICY_JSON"

echo "🟡 Creating access key..."
KEY_COUNT=$(aws iam list-access-keys --user-name "$IAM_USER" --query 'length(AccessKeyMetadata)' --output text)
if [ "$KEY_COUNT" -ge 2 ]; then
  echo "⚠️  '$IAM_USER' already has 2 access keys (AWS limit). Delete one in the IAM console, or set"
  echo "    AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in .env.local manually. Skipping key creation."
  AKID=""; SECRET=""
else
  read -r AKID SECRET < <(aws iam create-access-key --user-name "$IAM_USER" \
    --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
  echo "✅ Access key created (shown only once)."
fi

# ---------------- .env.local ----------------
ENV_FILE=".env.local"
if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "${ENV_FILE}.bak.$(date +%s)"
  echo "ℹ️  Existing .env.local backed up."
fi
SESSION_SECRET="$(openssl rand -hex 32)"
cat > "$ENV_FILE" <<EOF
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_PASSWORD=$ADMIN_PASSWORD
SESSION_SECRET=$SESSION_SECRET
AWS_REGION=$REGION
DYNAMODB_TABLE=$TABLE
S3_BUCKET=$BUCKET
AWS_ACCESS_KEY_ID=$AKID
AWS_SECRET_ACCESS_KEY=$SECRET
NEXT_PUBLIC_REGISTRY_TITLE=Baby Registry
NEXT_PUBLIC_REGISTRY_SUBTITLE=We're having a baby!
EOF

echo
echo "🎉 Done! Wrote $ENV_FILE"
echo "------------------------------------------------------------"
echo " Admin username : $ADMIN_USERNAME"
echo " Admin password : $ADMIN_PASSWORD"
echo "------------------------------------------------------------"
echo "Next:  npm install && npm run dev    (http://localhost:3000)"
echo "Then deploy with: ./scripts/publish.sh"
echo "When deploying to Vercel, copy these same values into the project's Environment Variables."
