# @remedence/api

Future HTTP service for the canonical Remedence API. Implementations must conform to `../../api/openapi.yaml` rather than creating a separate web-only contract.

The v1 repository establishes the contract and product workflow first. Authentication, authorization, persistence, and worker-backed execution are intentionally deferred until those controls can be implemented and tested as backend services.
