#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-ca-central-1}"
STACK="${STACK_NAME:-sap-agent-choreography-demo}"
SITE_URL="${SITE_URL:-https://solacese.github.io/sap-agent-choreography/}"

command -v aws >/dev/null || { echo "aws CLI is required" >&2; exit 1; }
command -v npx >/dev/null || { echo "npm/npx is required" >&2; exit 1; }
aws sts get-caller-identity --region "$REGION" >/dev/null

rm -rf .aws-sam/build
mkdir -p .aws-sam/build/api .aws-sam/build/worker .aws-sam/build/aggregator
npx esbuild backend/api.ts --bundle --platform=node --target=node22 --outfile=.aws-sam/build/api/index.js
npx esbuild backend/worker.ts --bundle --platform=node --target=node22 --outfile=.aws-sam/build/worker/index.js
npx esbuild backend/aggregator.ts --bundle --platform=node --target=node22 --outfile=.aws-sam/build/aggregator/index.js

cp template.yaml .aws-sam/template.yaml
python3 - <<'PY'
from pathlib import Path
p=Path('.aws-sam/template.yaml')
s=p.read_text()
s=s.replace('CodeUri: .\n      Handler: backend/api.handler', 'CodeUri: build/api/\n      Handler: index.handler')
s=s.replace('CodeUri: .\n      Handler: backend/worker.handler', 'CodeUri: build/worker/\n      Handler: index.handler')
s=s.replace('CodeUri: .\n      Handler: backend/aggregator.handler', 'CodeUri: build/aggregator/\n      Handler: index.handler')
lines=[]
skip=False
for line in s.splitlines():
    if line.startswith('    Metadata:') or line.startswith('    Metadata: &WorkerBuild'):
        skip=True
        continue
    if skip and (line.startswith('  ') and not line.startswith('      ')):
        skip=False
    if not skip:
        lines.append(line)
p.write_text('\n'.join(lines)+'\n')
PY

aws cloudformation package \
  --template-file .aws-sam/template.yaml \
  --s3-bucket "${ARTIFACT_BUCKET:-$(aws s3api list-buckets --query 'Buckets[?contains(Name, `sap-agent-choreography-artifacts`)].Name | [0]' --output text)}" \
  --output-template-file .aws-sam/packaged.yaml \
  --region "$REGION" >/dev/null 2>&1 || {
    BUCKET="sap-agent-choreography-artifacts-$(aws sts get-caller-identity --query Account --output text)-$REGION"
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null 2>&1 || true
    aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration '{"Rules":[{"ID":"expire-builds","Status":"Enabled","Filter":{},"Expiration":{"Days":7}}]}' >/dev/null
    aws cloudformation package --template-file .aws-sam/template.yaml --s3-bucket "$BUCKET" --output-template-file .aws-sam/packaged.yaml --region "$REGION" >/dev/null
  }

aws cloudformation deploy \
  --template-file .aws-sam/packaged.yaml \
  --stack-name "$STACK" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides SiteUrl="$SITE_URL" MonthlyBudgetUsd=20 \
  --tags Project=sap-agent-choreography CostProfile=demo \
  --region "$REGION" \
  --no-fail-on-empty-changeset

API_URL=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --query 'Stacks[0].Outputs[?OutputKey==`ApiBaseUrl`].OutputValue' --output text)
SOLACE_SECRET=$(aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" --query 'Stacks[0].Outputs[?OutputKey==`SolaceSecretArn`].OutputValue' --output text)
printf '{"mode":"cloud","apiBaseUrl":"%s"}\n' "$API_URL" > public/runtime-config.json

printf '\nCloud backend deployed.\nAPI: %s\nSolace secret: %s\nNext: fill the Solace secret and run npm run configure:solace.\n' "$API_URL" "$SOLACE_SECRET"
