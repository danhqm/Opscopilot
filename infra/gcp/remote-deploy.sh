#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

if [[ "$#" -ne 6 ]]; then
  echo "Usage: remote-deploy.sh <image-tag> <image-registry> <domain-or-empty> <secret-id> <secret-version> <staging-dir>" >&2
  exit 1
fi

image_tag="$1"
image_registry="$2"
domain="$3"
secret_id="$4"
secret_version="$5"
staging_dir="$6"
install_dir=/opt/ops-copilot

if [[ ! "$image_tag" =~ ^[a-f0-9]{7,64}$ ]]; then
  echo "Image tag must be a Git commit SHA." >&2
  exit 1
fi

if [[ ! "$image_registry" =~ ^[a-z0-9-]+-docker\.pkg\.dev/[a-z][a-z0-9-]{4,28}[a-z0-9]/[a-z][a-z0-9._-]+$ ]]; then
  echo "Invalid Artifact Registry image path." >&2
  exit 1
fi

if [[ ! "$secret_id" =~ ^[a-zA-Z0-9_-]{1,255}$ ]]; then
  echo "Invalid Secret Manager secret ID." >&2
  exit 1
fi

if [[ ! "$secret_version" =~ ^[1-9][0-9]*$ ]]; then
  echo "Secret Manager version must be an explicit positive integer." >&2
  exit 1
fi

if [[ ! "$staging_dir" =~ ^/tmp/ops-copilot-[a-f0-9]{7,64}$ ]]; then
  echo "Invalid staging directory." >&2
  exit 1
fi

required_files=(
  docker-compose.prod.yml
  infra/nginx/nginx.conf
  infra/nginx/production.conf
  infra/nginx/production-http.conf
  infra/gcp/issue-certificate.sh
  infra/gcp/sync-certificate.sh
)

for file in "${required_files[@]}"; do
  if [[ ! -s "${staging_dir}/${file}" ]]; then
    echo "Missing deployment file: ${file}" >&2
    exit 1
  fi
done

install -d -m 0750 "$install_dir"
install -d -m 0755 "$install_dir/infra/nginx" "$install_dir/infra/gcp"
install -d -m 0755 "$install_dir/tls" /var/www/certbot

install -m 0644 "${staging_dir}/docker-compose.prod.yml" "${install_dir}/docker-compose.prod.yml"
install -m 0644 "${staging_dir}/infra/nginx/nginx.conf" "${install_dir}/infra/nginx/nginx.conf"
install -m 0644 "${staging_dir}/infra/nginx/production.conf" "${install_dir}/infra/nginx/production.conf"
install -m 0644 "${staging_dir}/infra/nginx/production-http.conf" "${install_dir}/infra/nginx/production-http.conf"
install -m 0755 "${staging_dir}/infra/gcp/issue-certificate.sh" "${install_dir}/infra/gcp/issue-certificate.sh"
install -m 0755 "${staging_dir}/infra/gcp/sync-certificate.sh" "${install_dir}/infra/gcp/sync-certificate.sh"

if [[ ! -s "${install_dir}/tls/fullchain.pem" || ! -s "${install_dir}/tls/privkey.pem" ]]; then
  openssl req \
    -x509 \
    -newkey rsa:2048 \
    -nodes \
    -days 7 \
    -keyout "${install_dir}/tls/privkey.pem" \
    -out "${install_dir}/tls/fullchain.pem" \
    -subj '/CN=bootstrap.invalid'
  chmod 0600 "${install_dir}/tls/privkey.pem"
  chmod 0644 "${install_dir}/tls/fullchain.pem"
fi

if [[ -n "$domain" ]]; then
  if [[ ! "$domain" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$ ]]; then
    echo "Invalid deployment domain." >&2
    exit 1
  fi
  public_origin="https://${domain}"
  cookie_secure=true
  nginx_site_config=./infra/nginx/production.conf
else
  external_ip="$(curl -fsS -H 'Metadata-Flavor: Google' \
    'http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip')"
  if [[ ! "$external_ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    echo "Could not determine the VM external IPv4 address." >&2
    exit 1
  fi
  public_origin="http://${external_ip}"
  cookie_secure=false
  nginx_site_config=./infra/nginx/production-http.conf
fi

secret_temp=''
registry_host=''
cleanup_deploy() {
  if [[ -n "$secret_temp" ]]; then
    rm -f -- "$secret_temp"
  fi
  if [[ -n "$registry_host" ]]; then
    docker logout "$registry_host" >/dev/null 2>&1 || true
  fi
}
trap cleanup_deploy EXIT

project_id="$(curl -fsS -H 'Metadata-Flavor: Google' \
  'http://metadata.google.internal/computeMetadata/v1/project/project-id')"
if [[ ! "$project_id" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; then
  echo "Could not determine the GCP project ID." >&2
  exit 1
fi

metadata_url='http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'
access_token="$(curl -fsS -H 'Metadata-Flavor: Google' "$metadata_url" | jq -er '.access_token')"
secret_temp="$(mktemp "${install_dir}/.env.production.XXXXXX")"

curl -fsS \
  -H "Authorization: Bearer ${access_token}" \
  "https://secretmanager.googleapis.com/v1/projects/${project_id}/secrets/${secret_id}/versions/${secret_version}:access" \
  | jq -er '.payload.data | @base64d' > "$secret_temp"

for required_key in MYSQL_PASSWORD MYSQL_ROOT_PASSWORD JWT_ACCESS_SECRET INTERNAL_API_TOKEN OPENAI_API_KEY; do
  if ! grep -Eq "^${required_key}=.+" "$secret_temp"; then
    echo "Production secret is missing a value for ${required_key}." >&2
    exit 1
  fi
done

install -m 0600 "$secret_temp" "${install_dir}/.env.production"
rm -f -- "$secret_temp"
secret_temp=''

release_file="${install_dir}/.release.env"
previous_release="${install_dir}/.release.previous.env"

if [[ -s "$release_file" ]]; then
  cp "$release_file" "$previous_release"
fi

cat > "$release_file" <<EOF
IMAGE_REGISTRY=${image_registry}
IMAGE_TAG=${image_tag}
DOMAIN=${domain}
PUBLIC_ORIGIN=${public_origin}
COOKIE_SECURE=${cookie_secure}
NGINX_SITE_CONFIG=${nginx_site_config}
EOF
chmod 0600 "$release_file"

registry_host="${image_registry%%/*}"
printf '%s' "$access_token" | docker login \
  --username oauth2accesstoken \
  --password-stdin \
  "https://${registry_host}" >/dev/null
unset access_token

compose() {
  docker compose \
    --env-file "${install_dir}/.env.production" \
    --env-file "$release_file" \
    --file "${install_dir}/docker-compose.prod.yml" \
    "$@"
}

rollback() {
  if [[ -s "$previous_release" ]]; then
    echo "Deployment health check failed; restoring the previous image tag." >&2
    cp "$previous_release" "$release_file"
    compose pull
    compose up -d --remove-orphans
  else
    echo "Deployment health check failed and no previous release is available." >&2
  fi
}

compose config --quiet
compose pull

if ! compose up -d --remove-orphans; then
  rollback
  exit 1
fi

healthy=false
for _ in $(seq 1 30); do
  if [[ -n "$domain" ]]; then
    health_result="$(curl \
      --fail \
      --insecure \
      --silent \
      --show-error \
      --resolve "${domain}:443:127.0.0.1" \
      "https://${domain}/api/ready" || true)"
  else
    health_result="$(curl \
      --fail \
      --silent \
      --show-error \
      'http://127.0.0.1/api/ready' || true)"
  fi

  if [[ -n "$health_result" ]]; then
    healthy=true
    break
  fi
  sleep 5
done

if [[ "$healthy" != true ]]; then
  compose ps >&2
  rollback
  exit 1
fi

rm -rf -- "$staging_dir"
echo "Ops Copilot ${image_tag} is healthy at ${public_origin}."
