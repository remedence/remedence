# Security policy

## Supported versions

Remedence is currently a `0.x` local beta. Security fixes are applied to the latest commit on `main`; older commits and prerelease snapshots are not supported release lines.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting flow at `https://github.com/remedence/remedence/security/advisories/new`. Do not include exploit details, credentials, customer data, or secrets in a public issue.

Include the affected commit or version, local deployment assumptions, reproduction steps using non-sensitive fixtures, impact, and any suggested mitigation. Maintainers will acknowledge when the private report is available, but local beta has no contractual response SLA.

If private vulnerability reporting is unavailable, open a public issue containing only a request for a private security contact. Do not publish the vulnerability details.

The current product is unauthenticated local beta and must remain loopback-only. A report that depends on direct untrusted-network exposure should still identify any defense-in-depth failure, but network exposure itself is outside the supported threat boundary.
