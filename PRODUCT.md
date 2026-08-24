# Remedence Product Direction

## Product

Remedence is an evidence-backed remediation platform for MSPs and enterprise security teams. It separates patch creation from independent verification and gives operators a durable record of what changed, how it was checked, and why a finding can be considered closed.

Core rule:

```text
PATCHED does not equal VERIFIED FIXED.
```

Primary workflow:

```text
Remediate -> Verify -> Prove
```

## Initial commercial audience

The first paid audience is small and mid-sized MSPs that manage security work across multiple customer organizations. Enterprise security teams are the expansion audience. The core workflow remains self-hostable; paid offerings monetize managed hosting, operational scale, workforce controls, managed verification, reporting automation, and support.

## First product experience

A new operator must be able to:

1. Sign in safely with an operator-provisioned account or configured OAuth/OIDC provider.
2. Create or enter an authorized organization.
3. Understand the Remedence trust model without reading documentation.
4. Complete a guided path from a finding to independent verification and client-ready proof.
5. See operational health, pending work, and delivery failures without leaving the product.

The default installation is an empty workspace. Demo data is an explicit choice and is always identified as fictional.

## Voice

- Calm, direct, and technically precise.
- Evidence before claims.
- Short labels and concrete actions.
- Explain consequences without alarmism.
- Never imply that a patch, worker, integration, or report succeeded unless a persisted receipt supports it.
- Never invent customers, certifications, availability, response times, or security guarantees.

## Visual language

- Serious operational software for security professionals.
- Deep teal `#0B6F65`, slate `#1F2933`, cool gray `#6B7280`, light gray `#E5E7EB`, and off white `#F5F7F8`.
- IBM Plex Sans for interface text and IBM Plex Mono for identifiers, timestamps, hashes, and technical metadata.
- Restrained surfaces, consistent spacing, written status labels, and visible focus states.
- Security status is never communicated by color alone.
- Avoid cyberpunk imagery, glow effects, shields, locks, decorative gradients, excessive cards, and generic AI language.

## Product guardrails

- Tenant identity comes from the authenticated principal.
- Public sign-up stays disabled until an explicit commercial onboarding policy exists.
- OAuth/OIDC callbacks use exact trusted origins, state and nonce binding, provider issuer and audience validation, and verified-email rules.
- External identity never grants organization membership by itself.
- Every workforce, policy, notification, and security-relevant mutation creates an audit event.
- Onboarding and tours are resumable, dismissible, keyboard accessible, and backed by durable per-user progress.
- Observability views expose bounded operational metadata, not secrets, tokens, evidence bytes, or raw customer payloads.

