# Changelog

All notable changes will be documented here. Remedence follows Semantic Versioning for release tags; `0.x` remains local beta unless release notes explicitly state that another release model's gates passed.

## Unreleased

### Added

- Local HTTP security headers, same-origin mutation rejection, request-rate budgets, and bounded server timeouts.
- Separate liveness and readiness probes.
- Validated, non-overwriting SQLite restore flow and recovery runbook.
- Security, dependency, secret, and SBOM CI workflows.

### Changed

- Repository installs, workspace scripts, CI, and dependency locking now use Bun 1.4; Node remains the application runtime for `node:sqlite`.
- Verification now rejects an asserted verifier label matching the persisted remediation owner.
- Formatter scope excludes generated `.wrangler/` state.

## 0.1.0 - 2026-08-20

- Initial local-beta product shell, OpenAPI contract, persistent SQLite workflows, failed-first verification history, locked evidence metadata, append-only audit events, immutable reports, local production serving, backup foundation, and repository-wide checks.
