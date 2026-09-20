#!/usr/bin/env bash
set -Eeuo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates \
  certbot \
  curl \
  gnupg \
  jq \
  openssl \
  unattended-upgrades

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
architecture="$(dpkg --print-architecture)"
codename="${UBUNTU_CODENAME:-$VERSION_CODENAME}"
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
  "$architecture" "$codename" > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y --no-install-recommends \
  containerd.io \
  docker-buildx-plugin \
  docker-ce \
  docker-ce-cli \
  docker-compose-plugin

systemctl enable --now docker

install -d -m 0750 /opt/ops-copilot
install -d -m 0755 /opt/ops-copilot/infra/nginx
install -d -m 0755 /opt/ops-copilot/infra/gcp
install -d -m 0755 /opt/ops-copilot/tls
install -d -m 0755 /var/www/certbot

if [[ ! -s /opt/ops-copilot/tls/fullchain.pem || ! -s /opt/ops-copilot/tls/privkey.pem ]]; then
  openssl req \
    -x509 \
    -newkey rsa:2048 \
    -nodes \
    -days 7 \
    -keyout /opt/ops-copilot/tls/privkey.pem \
    -out /opt/ops-copilot/tls/fullchain.pem \
    -subj '/CN=bootstrap.invalid'
  chmod 0600 /opt/ops-copilot/tls/privkey.pem
  chmod 0644 /opt/ops-copilot/tls/fullchain.pem
fi

dpkg-reconfigure -f noninteractive unattended-upgrades
touch /var/lib/ops-copilot-bootstrap-complete
