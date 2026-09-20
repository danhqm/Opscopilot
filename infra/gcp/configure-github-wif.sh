#!/usr/bin/env bash
set -Eeuo pipefail

require_value() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Required environment variable is empty: $name" >&2
    exit 1
  fi
}

command -v gcloud >/dev/null 2>&1 || {
  echo "Required command not found: gcloud" >&2
  exit 1
}

require_value GCP_PROJECT_ID
require_value GITHUB_REPOSITORY

WIF_POOL_ID="${WIF_POOL_ID:-github}"
WIF_PROVIDER_ID="${WIF_PROVIDER_ID:-ops-copilot}"
GITHUB_SERVICE_ACCOUNT_NAME="${GITHUB_SERVICE_ACCOUNT_NAME:-ops-copilot-github}"
github_service_account="${GITHUB_SERVICE_ACCOUNT_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "$GCP_PROJECT_ID"
project_number="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"

if ! gcloud iam workload-identity-pools describe "$WIF_POOL_ID" --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$WIF_POOL_ID" \
    --location=global \
    --display-name="GitHub Actions"
fi

if ! gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER_ID" \
  --workload-identity-pool="$WIF_POOL_ID" \
  --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER_ID" \
    --workload-identity-pool="$WIF_POOL_ID" \
    --location=global \
    --display-name="Ops Copilot GitHub repository" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
    --attribute-condition="assertion.repository == '${GITHUB_REPOSITORY}' && assertion.ref == 'refs/heads/main'"
else
  gcloud iam workload-identity-pools providers update-oidc "$WIF_PROVIDER_ID" \
    --workload-identity-pool="$WIF_POOL_ID" \
    --location=global \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
    --attribute-condition="assertion.repository == '${GITHUB_REPOSITORY}' && assertion.ref == 'refs/heads/main'"
fi

principal="principalSet://iam.googleapis.com/projects/${project_number}/locations/global/workloadIdentityPools/${WIF_POOL_ID}/attribute.repository/${GITHUB_REPOSITORY}"

gcloud iam service-accounts add-iam-policy-binding "$github_service_account" \
  --role="roles/iam.workloadIdentityUser" \
  --member="$principal" >/dev/null

provider="projects/${project_number}/locations/global/workloadIdentityPools/${WIF_POOL_ID}/providers/${WIF_PROVIDER_ID}"

cat <<EOF

GitHub Workload Identity Federation is ready.

Repository variable GCP_PROJECT_ID=${GCP_PROJECT_ID}
Repository secret   GCP_WORKLOAD_IDENTITY_PROVIDER=${provider}
Repository secret   GCP_DEPLOY_SERVICE_ACCOUNT=${github_service_account}
EOF
