#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

if [[ "$#" -ne 2 ]]; then
  echo "Usage: issue-certificate.sh <domain> <email>" >&2
  exit 1
fi

domain="$1"
email="$2"
install_dir=/opt/ops-copilot

if [[ ! "$domain" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$ ]]; then
  echo "Invalid domain." >&2
  exit 1
fi

if [[ ! "$email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "Invalid email address." >&2
  exit 1
fi

challenge_dir=/var/www/certbot/.well-known/acme-challenge
install -d -m 0755 "$challenge_dir"
challenge_file="$(mktemp "${challenge_dir}/ops-copilot-preflight.XXXXXX")"
challenge_name="$(basename "$challenge_file")"
challenge_value="ops-copilot-${RANDOM}-${RANDOM}"
printf '%s' "$challenge_value" > "$challenge_file"
trap 'rm -f -- "$challenge_file"' EXIT

served_value="$(curl \
  --fail \
  --max-time 15 \
  --silent \
  --show-error \
  "http://${domain}/.well-known/acme-challenge/${challenge_name}")"

if [[ "$served_value" != "$challenge_value" ]]; then
  echo "The ACME preflight response did not match. Check DNS and port 80." >&2
  exit 1
fi

rm -f -- "$challenge_file"
trap - EXIT

certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --cert-name ops-copilot \
  --domain "$domain" \
  --email "$email" \
  --agree-tos \
  --no-eff-email \
  --non-interactive \
  --keep-until-expiring

install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
install -m 0755 \
  "${install_dir}/infra/gcp/sync-certificate.sh" \
  /etc/letsencrypt/renewal-hooks/deploy/ops-copilot-reload

"${install_dir}/infra/gcp/sync-certificate.sh"
systemctl enable --now certbot.timer

echo "TLS certificate installed for ${domain}."
