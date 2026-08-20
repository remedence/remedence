# Remedence

Open-source security remediation, independent verification, evidence, and API-first platform for MSPs and security teams.

**Security work. Proven complete.**

Remedence connects findings from existing security tools to remediation work, a separate verification path, and evidence-backed closure.

`Remediate -> Verify -> Prove`

A patch is not a verification result. Failed verification remains part of the history and a finding reaches **Verified fixed** only after the independent verification path passes.

## v1 repository status

The current v1 contains a working React operator interface using the approved fictional Harborline Technology Group demo dataset, including the SEC-1042 failed-first-verification workflow. The canonical OpenAPI 3.1 contract is in `api/openapi.yaml`.

Backend persistence, production authentication and authorization, hosted verification workers, managed integrations, and cloud operations are intentionally not represented as complete yet.

## Development

```powershell
npm install
npm run dev
```

Quality checks:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

## Architecture

- `apps/web` operator interface
- `apps/api` future API service implementation
- `packages/core` shared domain rules
- `packages/database` persistence boundary
- `packages/evidence` evidence and provenance boundary
- `packages/verification` independent verification contracts
- `packages/ui` reusable product primitives when justified
- `packages/cli` future API client
- `workers/verification` future verification runtime
- `api/openapi.yaml` canonical REST contract
- `integrations` source and destination adapters
- `docs` architecture and demo workflow documentation

See `docs/architecture.md` and `docs/demo-workflow.md` for the v1 boundaries and scenario.
