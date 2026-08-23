# Contributing

Remedence welcomes focused issues and pull requests that preserve its remediation, independent-verification, locked-evidence, audit, and immutable-reporting invariants.

## Before opening a change

- Read `README.md`, `docs/architecture.md`, and the applicable package README.
- Keep local beta fixed to loopback unless authenticated production deployment is implemented and reviewed as a separate change.
- Extend the existing domain, repository, API, or UI owner instead of creating parallel state.
- Do not commit credentials, customer data, generated Wrangler state, databases, reports, or local artifacts.
- For security vulnerabilities, follow `SECURITY.md` instead of opening a public exploit-bearing issue.

## Development

Use a supported Node release and the committed lockfile:

```text
npm ci
npm run check
```

Changes should include focused tests through the production interface, documentation for changed behavior or ownership, and generated API updates when `api/openapi.yaml` changes. Do not weaken validation or replace durable read-back with unconditional success.

Use small Conventional Commit subjects such as `fix(api): reject cross-origin mutations`. A pull request should state changed behavior, validation commands and exact results, known warnings, migrations, compatibility impact, and remaining risks.

## License

The repository does not yet contain an approved open-source license. Contributions cannot be accepted under an inferred license; maintainers must select and add the governing license first.
