# Ops Copilot production deployment

Phase 8 deploys the existing Compose application to one Google Compute Engine VM. GitHub Actions tests every pull request. A merge to `main` builds five immutable images, pushes them to Artifact Registry, copies only the production manifest and scripts to the VM, runs the Prisma migration, replaces the services, and rolls the application images back if `/api/ready` does not become healthy.

## Production topology

```text
GitHub Actions (OIDC, no GCP JSON key)
  |-- lint, unit tests, Python tests, MySQL integration test, Node builds
  |-- build/push SHA-tagged images -> Artifact Registry
  `-- OS Login SCP/SSH -> Compute Engine

Compute Engine e2-standard-2, Ubuntu 24.04
  Nginx :80 initially, :443 after a domain is configured -> frontend, API, agent
  API + worker + migrator
  agent service + MCP server
  MySQL + Redis + ChromaDB
  named Docker volumes on a 50 GB balanced persistent disk
```

The single VM is intentionally appropriate for a portfolio/demo deployment. It is not highly available: a VM or zonal disk failure interrupts the application. The next production step would move MySQL, Redis, object storage, and vector storage to managed services before adding multiple stateless application replicas.

## 1. Prerequisites

- A billed Google Cloud project and permission to create IAM, Compute Engine, Artifact Registry, address, and firewall resources.
- `gcloud` authenticated locally with `gcloud auth login` and `gcloud auth application-default login`.
- The repository hosted on GitHub, with `main` as the deployment branch.
- Optional for TLS: a domain or subdomain whose DNS A record you can edit. Without one, the first deployment serves HTTP on the reserved VM address.
- Git Bash, WSL, macOS, or Linux for the provisioning scripts.

The scripts default to Singapore (`asia-southeast1`, zone `asia-southeast1-b`) and an `e2-standard-2` VM with 2 vCPU and 8 GiB RAM. Override the variables before provisioning if another region or size is preferable.

## 2. Provision GCP

From the repository root in a Bash shell:

```bash
export GCP_PROJECT_ID="your-project-id"
export GCP_REGION="asia-southeast1"
export GCP_ZONE="asia-southeast1-b"
export GCP_VM_NAME="ops-copilot"
export GAR_REPOSITORY="ops-copilot"

bash infra/gcp/provision.sh
```

The idempotent script enables the required APIs and creates:

- a regional Docker repository;
- a VM runtime service account with Artifact Registry read access;
- a GitHub deployer service account with repository write and OS Login access;
- a reserved regional external IPv4 address;
- an HTTP/HTTPS firewall rule;
- an Ubuntu 24.04 VM with OS Login, a 50 GB balanced disk, Docker Compose, Certbot, unattended security updates, and a short-lived bootstrap certificate.

Wait for the startup script to finish:

```bash
gcloud compute ssh "$GCP_VM_NAME" \
  --project "$GCP_PROJECT_ID" \
  --zone "$GCP_ZONE" \
  --command 'sudo test -f /var/lib/ops-copilot-bootstrap-complete && docker compose version'
```

The external IP printed by `provision.sh` is the initial application address. If a domain is added later, point its A record to that address before requesting a certificate.

## 3. Configure keyless GitHub authentication

Set the exact GitHub `owner/repository` name and run:

```bash
export GITHUB_REPOSITORY="your-github-owner/your-repository"
bash infra/gcp/configure-github-wif.sh
```

This creates an OIDC provider restricted to that exact repository and grants it permission to impersonate only the deployer service account. No downloadable Google service-account key is created.

The checked-in workflow contains this deployment's non-secret GCP identifiers. If the infrastructure is renamed, update these workflow environment values:

| Variable | Example |
|---|---|
| `GCP_PROJECT_ID` | `my-ops-project` |
| `GCP_REGION` | `asia-southeast1` |
| `GCP_ZONE` | `asia-southeast1-b` |
| `GCP_VM_NAME` | `ops-copilot` |
| `GAR_REPOSITORY` | `ops-copilot` |
| `OPS_COPILOT_DOMAIN` | Optional; an empty value uses public-IP HTTP, while `ops.example.com` enables HTTPS |
| `PRODUCTION_SECRET_ID` | `ops-copilot-production-env` |
| `PRODUCTION_SECRET_VERSION` | Explicit numeric Secret Manager version, initially `1` |

No GitHub secret contains application credentials or a Google service-account key. Production application values live in the single GCP Secret Manager secret created by `provision.sh`; the VM runtime identity can read only that secret.

Generate independent high-entropy values for the database passwords, `JWT_ACCESS_SECRET`, and `INTERNAL_API_TOKEN`. Prepare the value from `.env.production.example` without committing it. For example:

```bash
cp .env.production.example .env.production
openssl rand -hex 32
```

Edit `.env.production`, then add its contents as the first secret version:

```bash
gcloud secrets versions add ops-copilot-production-env \
  --project "$GCP_PROJECT_ID" \
  --data-file=.env.production
```

Delete the local production file after confirming the version exists. The deploy script requests the explicit version in `PRODUCTION_SECRET_VERSION` and installs it as `/opt/ops-copilot/.env.production` with mode `0600`. When rotating credentials, add a new version and update that numeric workflow value.

For an approval gate, configure required reviewers on the GitHub `production` environment. The workflow already targets that environment.

## 4. First deployment

Push or merge to `main`. The workflow in `.github/workflows/ci-cd.yml` performs the complete CI/CD path. Images receive both the immutable Git commit SHA tag and a convenience `latest` tag; deployment always uses the SHA.

With `OPS_COPILOT_DOMAIN` unset, the first release is available at `http://EXTERNAL_IP`. This is suitable only for temporary testing: HTTP does not protect passwords, uploaded documents, or chat content in transit.

To enable HTTPS later, point the domain to the reserved IP, set `OPS_COPILOT_DOMAIN`, and rerun the workflow. That release initially uses the bootstrap certificate. Install the public certificate immediately afterward:

```bash
gcloud compute ssh "$GCP_VM_NAME" \
  --project "$GCP_PROJECT_ID" \
  --zone "$GCP_ZONE" \
  --command "sudo /opt/ops-copilot/infra/gcp/issue-certificate.sh ops.example.com you@example.com"
```

Certbot uses the HTTP webroot challenge, copies the issued certificate into the Nginx mount, reloads Nginx, and enables its systemd renewal timer. Verify renewal once:

```bash
gcloud compute ssh "$GCP_VM_NAME" \
  --project "$GCP_PROJECT_ID" \
  --zone "$GCP_ZONE" \
  --command 'sudo certbot renew --dry-run'
```

## 5. Verify the live system

```bash
curl -fsS "http://EXTERNAL_IP/api/ready"
curl -fsS "http://EXTERNAL_IP/agent/ready"
curl -fsS "http://EXTERNAL_IP/nginx-health"
```

After a domain and certificate are configured:

```bash
curl -fsS "https://ops.example.com/api/ready"
curl -fsS "https://ops.example.com/agent/ready"
curl -fsS "https://ops.example.com/nginx-health"
```

Open the active URL, create an account, and follow `docs/demo-kit/FULL_PRODUCT_TEST.md` for the complete RAG, MCP, and workflow demonstration. Do not use real credentials or sensitive documents while running over HTTP.

On the VM, inspect service health and logs with:

```bash
cd /opt/ops-copilot
sudo docker compose \
  --env-file .env.production \
  --env-file .release.env \
  -f docker-compose.prod.yml ps

sudo docker compose \
  --env-file .env.production \
  --env-file .release.env \
  -f docker-compose.prod.yml logs --tail=200
```

## Rollback

If a new release fails its readiness check, `remote-deploy.sh` automatically restores `.release.previous.env` and recreates the previous application images. To trigger the same image rollback manually:

```bash
cd /opt/ops-copilot
sudo cp .release.previous.env .release.env
sudo docker compose \
  --env-file .env.production \
  --env-file .release.env \
  -f docker-compose.prod.yml pull
sudo docker compose \
  --env-file .env.production \
  --env-file .release.env \
  -f docker-compose.prod.yml up -d --remove-orphans
```

Database migrations are forward-only. An image rollback does not reverse a schema migration, so breaking migrations must use an expand/migrate/contract sequence and must remain compatible with the previous application release.

## Persistent data and backups

MySQL, Redis, ChromaDB, and uploads use named Docker volumes on the VM's persistent boot disk. `docker compose down` retains them; `docker compose down --volumes` destroys them and must not be used in production.

For a demo, schedule Compute Engine disk snapshots and test a restore. For a business-critical deployment, use application-consistent MySQL backups plus managed data services; a crash-consistent boot-disk snapshot is not a complete database backup strategy.

## Estimated monthly GCP cost

This is a planning estimate in USD for one always-on VM; verify the selected region in the Google Cloud Pricing Calculator before provisioning because prices and network usage vary.

| Item | Assumption | Approximate monthly cost |
|---|---|---:|
| Compute Engine | `e2-standard-2`, 730 hours | $49 in lower-cost US regions; budget about $60–65 in Singapore |
| Balanced persistent disk | 50 GiB | about $5–6 |
| External IPv4 | $0.005/hour, 730 hours | $3.65 |
| Artifact Registry | 5 GiB retained, first 0.5 GiB free | about $0.45 |
| DNS, egress, logs | workload-dependent | budget $1–15 for a light demo |
| **Expected demo total** | excluding domain registration and OpenAI API usage | **about $70–85/month** |

The VM is the dominant cost. An `e2-medium` is cheaper but its 4 GiB RAM is too tight for MySQL, ChromaDB, Next.js, Node, and two Python services running together. Stop the VM when it is not needed if preserving trial credit matters, but note that an attached reserved external IPv4 address remains billable.

## Security and operating notes

- GitHub obtains short-lived Google credentials through Workload Identity Federation; do not create a JSON service-account key.
- OS Login replaces project metadata SSH keys. The deploy service account receives administrative login because the single-VM Compose update needs Docker and `/opt` access.
- Only ports 80 and 443 are public. MySQL, Redis, ChromaDB, MCP, and service ports stay inside the Compose network.
- The VM runtime identity can pull from Artifact Registry but cannot push images.
- Production cookies are secure, CORS is pinned to the HTTPS domain, and image tags are immutable commit SHAs.
- Rotate `OPENAI_API_KEY`, database credentials, signing secrets, and internal tokens by adding a Secret Manager version, updating `PRODUCTION_SECRET_VERSION`, and rerunning the workflow.
- Review failed migrations before retrying. Prisma records migration state in MySQL and will not silently roll back a partially applied destructive change.
