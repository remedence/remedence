# Container deployment

This deployment is a reproducible, single-host product for the current SQLite-backed release. It does not convert the release into hosted multi-tenant SaaS or remove the production-database gate in `docs/release-model.md`.

## Image

Build once from a clean tagged revision and publish by digest:

```text
docker build --pull \
  --build-arg BUN_BASE_IMAGE=oven/bun:1.4.0@sha256:<verified-digest> \
  --build-arg NODE_BASE_IMAGE=node:26.4.0-bookworm-slim@sha256:<verified-digest> \
  --tag registry.example/remedence:<version> ..
docker push registry.example/remedence:<version>
docker buildx imagetools inspect registry.example/remedence:<version>
```

Run the build from this `deploy` directory. Resolve the two base references from the official Bun and Node registries and record their digests with the source commit, application image digest, SBOM/vulnerability-scan result, and `bun run check` evidence. Set `REMEDENCE_IMAGE`, `REMEDENCE_CLAMAV_IMAGE`, and `REMEDENCE_CADDY_IMAGE` to immutable `name@sha256:digest` values; the Dockerfile and Compose file reject missing references.

## Host preparation

1. Install a supported Docker Engine and Compose plugin.
2. Copy this directory to a versioned release directory and run the remaining commands from that directory.
3. Copy `.env.production.example` to `.env.production`, set mode `0600`, and replace every placeholder with independently generated material. Do not commit it.
4. Place the approved digest-pinned verification profile JSON at the configured path in the `remedence-data` volume before preflight. The optional verification-worker profile mounts the Docker socket and therefore must run only on a dedicated worker host; omit it on the application host unless that trust decision is explicit.
5. Point the public hostname at the host. Caddy obtains and renews TLS certificates and is the only published service.

## Controlled promotion

Validate configuration without printing secret values:

```text
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production run --rm preflight
```

Take and verify a backup before every schema change:

```text
docker compose --env-file .env.production run --rm \
  --entrypoint node migrate scripts/db-backup.mjs --output /var/lib/remedence/backups/pre-migrate.db
```

Promote in staging first:

```text
docker compose --env-file .env.production run --rm migrate
docker compose --env-file .env.production up -d clamav api integration-worker privacy-worker edge
docker compose --env-file .env.production ps
```

Wait for every health check, exercise authentication, tenant isolation, one reversible mutation, worker queues, evidence scan/upload, export, and backup restore. Promote the exact same image digest and configuration shape to production only after staging acceptance.

## Rollback

Application rollback is allowed only when the prior image declares compatibility with the current schema. Set `REMEDENCE_IMAGE` back to the recorded prior digest and run `docker compose up -d` without rerunning migration.

Schema rollback is restore-based because migrations are forward-only:

1. stop API and workers;
2. retain the failed database as incident evidence;
3. restore the verified pre-migration backup into an absent staging path with `db-restore.mjs`;
4. run the prior image preflight and `/readyz` against that staged database;
5. promote the staged file through an operator-controlled recoverable move;
6. start the prior image digest and verify local/remote state plus representative tenant records.

Never point an old image at a schema it does not support, reverse a migration with ad hoc SQL, or overwrite the only live database copy.
