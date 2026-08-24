# HTTP edge security

This document describes controls implemented by the local-beta HTTP process and the controls still required before network deployment is supported.

## Implemented local controls

The application owns these controls directly:

- the listener is fixed to `127.0.0.1`, and Express proxy trust is disabled;
- JSON request bodies are limited to 256 KiB, while the OpenAPI contract bounds strings, list sizes, page sizes, and verification checks;
- API responses and health responses use `Cache-Control: no-store`;
- responses set a restrictive same-origin Content Security Policy, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, MIME sniffing protection, a no-referrer policy, browser feature restrictions, and same-origin opener/resource policies;
- mutating `/api/*` requests with a foreign `Origin` or `Sec-Fetch-Site: cross-site` are rejected with a structured 403 Problem response before route code runs;
- development mode accepts one explicit `http://127.0.0.1:<port>` Vite origin (`REMEDENCE_DEV_ORIGIN`, default port 5173) so the browser proxy can reach the loopback API; production-local mode has no additional allowed origin;
- no CORS allow-list or wildcard response is emitted; local non-browser clients may omit browser origin headers;
- `/api/*` is limited to 600 requests per 60-second fixed window and returns `RateLimit-*` plus `Retry-After` headers with a structured 429 Problem response. Buckets are persisted atomically in the active database, coordinated across pooled production API processes, scoped once by client and again by authenticated tenant, and inactive keys are evicted;
- the Node server bounds header receipt to 10 seconds, request receipt to 15 seconds, idle keep-alive to 5 seconds, active socket lifetime without activity to 30 seconds, and 1,000 requests per socket;
- unexpected implementation errors return a generic Problem response with a request ID and do not expose stack traces, SQL, or local paths.

The database-backed limiter coordinates the supported local deployment model. It is still application-level defense in depth, not a substitute for connection-level denial-of-service protection at a supported network edge.

## TLS and proxy status

Local beta serves HTTP on loopback because browser and API run on the same local machine. Direct network exposure, environment-controlled public binding, and proxy trust are unsupported.

A future supported self-hosted mode must define and test all of the following before enabling a non-loopback listener:

- TLS version/cipher and certificate ownership at a named ingress implementation;
- an explicit trusted-proxy hop count or allow-list, never blanket proxy trust;
- canonical external origin and host validation;
- forwarded-protocol and client-address parsing only from the trusted ingress;
- HSTS at the HTTPS edge, redirect behavior, maximum request/response durations, connection limits, and shutdown draining;
- principal-, route-, and operation-specific quota policies plus ingress-level connection controls and fail-closed degradation behavior;
- authenticated CSRF tokens or an equivalent session-bound mechanism in addition to origin checks;
- a reviewed CSP for any externally hosted assets, identity redirects, telemetry endpoints, or embedded content;
- safe edge and application error correlation without forwarding internal diagnostics to clients.

No reverse-proxy recipe in this repository currently converts local beta into supported self-hosted mode.
