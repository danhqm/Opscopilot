#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

lineage=/etc/letsencrypt/live/ops-copilot
install_dir=/opt/ops-copilot

if [[ ! -s "${lineage}/fullchain.pem" || ! -s "${lineage}/privkey.pem" ]]; then
  echo "The ops-copilot certificate lineage does not exist." >&2
  exit 1
fi

install -m 0644 "${lineage}/fullchain.pem" "${install_dir}/tls/fullchain.pem"
install -m 0600 "${lineage}/privkey.pem" "${install_dir}/tls/privkey.pem"

if [[ -s "${install_dir}/.release.env" && -s "${install_dir}/.env.production" ]]; then
  docker compose \
    --env-file "${install_dir}/.env.production" \
    --env-file "${install_dir}/.release.env" \
    --file "${install_dir}/docker-compose.prod.yml" \
    exec -T nginx nginx -s reload
fi
