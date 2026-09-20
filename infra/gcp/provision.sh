#!/usr/bin/env bash
set -Eeuo pipefail

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

require_value() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Required environment variable is empty: $name" >&2
    exit 1
  fi
}

require_command gcloud
require_value GCP_PROJECT_ID

GCP_REGION="${GCP_REGION:-asia-southeast1}"
GCP_ZONE="${GCP_ZONE:-asia-southeast1-b}"
GCP_VM_NAME="${GCP_VM_NAME:-ops-copilot}"
GAR_REPOSITORY="${GAR_REPOSITORY:-ops-copilot}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-standard-2}"
BOOT_DISK_SIZE="${BOOT_DISK_SIZE:-50GB}"
VM_SERVICE_ACCOUNT_NAME="${VM_SERVICE_ACCOUNT_NAME:-ops-copilot-vm}"
GITHUB_SERVICE_ACCOUNT_NAME="${GITHUB_SERVICE_ACCOUNT_NAME:-ops-copilot-github}"
PRODUCTION_SECRET_ID="${PRODUCTION_SECRET_ID:-ops-copilot-production-env}"
ADDRESS_NAME="${ADDRESS_NAME:-ops-copilot-ip}"
FIREWALL_RULE_NAME="${FIREWALL_RULE_NAME:-ops-copilot-web}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
vm_service_account="${VM_SERVICE_ACCOUNT_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
github_service_account="${GITHUB_SERVICE_ACCOUNT_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "$GCP_PROJECT_ID"
gcloud services enable \
  artifactregistry.googleapis.com \
  compute.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  oslogin.googleapis.com \
  secretmanager.googleapis.com \
  sts.googleapis.com

if ! gcloud artifacts repositories describe "$GAR_REPOSITORY" --location "$GCP_REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$GAR_REPOSITORY" \
    --repository-format=docker \
    --location="$GCP_REGION" \
    --description="Ops Copilot production images"
fi

if ! gcloud iam service-accounts describe "$vm_service_account" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$VM_SERVICE_ACCOUNT_NAME" \
    --display-name="Ops Copilot VM runtime"
fi

if ! gcloud iam service-accounts describe "$github_service_account" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$GITHUB_SERVICE_ACCOUNT_NAME" \
    --display-name="Ops Copilot GitHub deployer"
fi

if ! gcloud secrets describe "$PRODUCTION_SECRET_ID" >/dev/null 2>&1; then
  gcloud secrets create "$PRODUCTION_SECRET_ID" \
    --replication-policy=automatic
fi

gcloud secrets add-iam-policy-binding "$PRODUCTION_SECRET_ID" \
  --member="serviceAccount:${vm_service_account}" \
  --role="roles/secretmanager.secretAccessor" >/dev/null

gcloud artifacts repositories add-iam-policy-binding "$GAR_REPOSITORY" \
  --location="$GCP_REGION" \
  --member="serviceAccount:${vm_service_account}" \
  --role="roles/artifactregistry.reader" >/dev/null

gcloud artifacts repositories add-iam-policy-binding "$GAR_REPOSITORY" \
  --location="$GCP_REGION" \
  --member="serviceAccount:${github_service_account}" \
  --role="roles/artifactregistry.writer" >/dev/null

gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
  --member="serviceAccount:${github_service_account}" \
  --role="roles/compute.osAdminLogin" >/dev/null

gcloud iam service-accounts add-iam-policy-binding "$vm_service_account" \
  --member="serviceAccount:${github_service_account}" \
  --role="roles/iam.serviceAccountUser" >/dev/null

if ! gcloud compute firewall-rules describe "$FIREWALL_RULE_NAME" >/dev/null 2>&1; then
  gcloud compute firewall-rules create "$FIREWALL_RULE_NAME" \
    --network=default \
    --allow=tcp:80,tcp:443 \
    --source-ranges=0.0.0.0/0 \
    --target-tags=ops-copilot-web \
    --description="Public HTTP and HTTPS for Ops Copilot"
fi

if ! gcloud compute addresses describe "$ADDRESS_NAME" --region "$GCP_REGION" >/dev/null 2>&1; then
  gcloud compute addresses create "$ADDRESS_NAME" --region="$GCP_REGION"
fi

external_ip="$(gcloud compute addresses describe "$ADDRESS_NAME" \
  --region "$GCP_REGION" \
  --format='value(address)')"

if ! gcloud compute instances describe "$GCP_VM_NAME" --zone "$GCP_ZONE" >/dev/null 2>&1; then
  gcloud compute instances create "$GCP_VM_NAME" \
    --zone="$GCP_ZONE" \
    --machine-type="$MACHINE_TYPE" \
    --image-family=ubuntu-2404-lts-amd64 \
    --image-project=ubuntu-os-cloud \
    --boot-disk-type=pd-balanced \
    --boot-disk-size="$BOOT_DISK_SIZE" \
    --address="$external_ip" \
    --service-account="$vm_service_account" \
    --scopes=cloud-platform \
    --metadata=enable-oslogin=TRUE,block-project-ssh-keys=TRUE \
    --metadata-from-file=startup-script="${script_dir}/bootstrap-vm.sh" \
    --tags=ops-copilot-web \
    --labels=app=ops-copilot,environment=production \
    --maintenance-policy=MIGRATE \
    --provisioning-model=STANDARD \
    --shielded-vtpm \
    --shielded-integrity-monitoring
fi

cat <<EOF

GCP infrastructure is ready.

External IP: ${external_ip}
VM:          ${GCP_VM_NAME} (${GCP_ZONE})
Registry:    ${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${GAR_REPOSITORY}
Secret:      ${PRODUCTION_SECRET_ID}

Point your domain's A record to ${external_ip}, then run configure-github-wif.sh.
EOF
