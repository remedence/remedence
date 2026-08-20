# Persistent Local Core v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Remedence's compiled demo state with a durable local API, SQLite persistence, real remediation and verification history, locked evidence metadata, report snapshots, and an API-backed web workflow.

**Architecture:** The React application consumes a generated client for the canonical OpenAPI 3.1 contract. An Express 5 API validates requests and JSON responses, delegates workflow rules to `packages/core`, and persists through repository interfaces implemented by `packages/database` with Node.js `node:sqlite`. Production local mode serves the built web application from the API process on `127.0.0.1`.

**Tech Stack:** Node.js 24 LTS and 26 Current, TypeScript 7, React 19, Vite 8, Express 5.2.1, express-openapi-validator 5.6.2, node:sqlite, openapi-typescript 7.13.0, openapi-fetch 0.17.0, Vitest 4, Supertest 7.2.2, Playwright 1.62, axe-core.

**Spec:** `docs/superpowers/specs/2026-08-20-persistent-local-core-v1-design.md`

## Global Constraints

- Preserve `api/openapi.yaml` as the canonical OpenAPI 3.1 contract under `/api/v1`.
- Support Node.js `>=24.15.0 <27`; validate Node.js 24 and 26 in CI.
- Bind the unauthenticated v1 API to `127.0.0.1` only.
- Use `node:sqlite` behind repository interfaces; do not leak SQLite types into `packages/core` or `apps/web`.
- Do not add arbitrary command execution, unrestricted outbound HTTP, permissive CORS, authentication claims, cloud claims, AI inference claims, pricing, or fake availability.
- A finding becomes `Verified fixed` only after a separate verification passes and evidence is recorded and locked in the same transaction.
- Preserve earlier failed verification runs after a later pass.
- Use `application/problem+json` for API errors.
- Every mutation writes an append-only audit event.
- Keep the approved IBM Plex typography, palette, 8px radius, evidence-first hierarchy, and WCAG 2.2 AA behavior.
- No workflow may rely on sound.
- Use TDD, microscopic commits, Codex review after each major checkpoint, and Design & Taste critique before merge.
- Do not force-push, reset hard, remove unrelated files, restart Home Computer Use, or terminate unrelated Node, browser, tunnel, gateway, or MCP processes.

---

## File Structure

The completed slice uses these responsibilities:

```text
api/openapi.yaml
  Canonical OpenAPI 3.1 contract.

apps/api/src/app.ts
  Express application composition without listening on a port.
apps/api/src/server.ts
  Process startup, static web serving, graceful shutdown.
apps/api/src/config.ts
  Validated environment and local-only bind settings.
apps/api/src/dependencies.ts
  Core services and repository composition.
apps/api/src/middleware/request-context.ts
  Request IDs and structured request timing.
apps/api/src/middleware/problem-handler.ts
  Domain, OpenAPI, and unexpected error conversion.
apps/api/src/routes/*.ts
  Thin HTTP adapters grouped by resource.

packages/core/src/domain/entities.ts
  Transport-independent entities and value types.
packages/core/src/domain/finding-state.ts
  Allowed finding transitions.
packages/core/src/domain/priority.ts
  Deterministic action-queue ordering.
packages/core/src/errors/domain-error.ts
  Stable domain error codes.
packages/core/src/ports/repositories.ts
  Persistence interfaces.
packages/core/src/ports/runtime.ts
  Clock and ID generator interfaces.
packages/core/src/services/*.ts
  Workflow orchestration.

packages/database/migrations/0001_initial.sql
  Initial schema.
packages/database/src/database.ts
  Safe SQLite open and close behavior.
packages/database/src/migrations.ts
  Transactional migration runner.
packages/database/src/transaction.ts
  Unit-of-work transaction helper.
packages/database/src/repositories/*.ts
  SQLite repository adapters.
packages/database/src/seed.ts
  Idempotent Harborline seed.
packages/database/src/backup.ts
  SQLite backup command support.

packages/evidence/src/index.ts
  Evidence hash and lock validation.
packages/verification/src/index.ts
  Verification input and result contracts.

apps/web/src/app/App.tsx
  Top-level data and overlay coordination.
apps/web/src/app/AppShell.tsx
  Navigation shell and global search.
apps/web/src/features/*
  Focused product pages and workflows.
apps/web/src/lib/api/client.ts
  Generated-contract fetch client.
apps/web/src/lib/api/schema.d.ts
  Generated OpenAPI types.
apps/web/src/lib/dialogs/useDialogFocus.ts
  Focus trap, inert background, Escape, and focus restoration.
apps/web/src/lib/findings/action.ts
  Shared desktop and mobile action routing.
apps/web/src/lib/findings/sort.ts
  Transitional local sorting helper, later replaced by API ordering.

scripts/dev.mjs
  Starts API and Vite with signal-safe cleanup.
scripts/check-generated-api.mjs
  Proves generated types match the contract.
scripts/db-migrate.mjs
scripts/db-seed.mjs
scripts/db-backup.mjs
  Local operational commands.
```

---

### Task 1: Establish cross-platform formatting and a clean baseline

**Files:**

- Create: `.gitattributes`
- Modify: `package.json`
- Test: existing repository checks

**Interfaces:**

- Consumes: existing Prettier scripts.
- Produces: fresh Windows and Linux checkouts with LF text files and unchanged binary assets.

- [ ] **Step 1: Add a failing baseline assertion**

Run this evidence command before changing files:

```powershell
git ls-files --eol package.json apps/web/src/App.tsx api/openapi.yaml
npm run format:check
```

Expected before the fix on a Windows checkout with `core.autocrlf=true`:

```text
i/lf w/crlf
Code style issues found
```

- [ ] **Step 2: Add explicit repository attributes**

Create `.gitattributes`:

```gitattributes
* text=auto eol=lf

*.png binary
*.ico binary
*.db binary
*.sqlite binary
*.sqlite3 binary
```

- [ ] **Step 3: Normalize the worktree without changing semantic content**

Run:

```powershell
npm run format
git add --renormalize .
git status --short
```

Expected: `.gitattributes` is the only semantic change. Existing text files may be rewritten in the worktree but should not appear as content changes after normalization.

- [ ] **Step 4: Add a single root verification command**

Add this script to root `package.json`:

```json
{
  "scripts": {
    "check:current": "npm run format:check && npm run lint && npm run typecheck && npm test && npm run build && npm run e2e"
  }
}
```

This name is temporary until the API workspaces are present. Task 16 replaces it with the final `check` script.

- [ ] **Step 5: Verify the baseline**

Run:

```powershell
npm run check:current
git diff --check
```

Expected: 4 Vitest tests pass, 11 Playwright tests pass, build succeeds, and no formatting warnings remain.

- [ ] **Step 6: Commit**

```powershell
git add .gitattributes package.json package-lock.json
git commit -m "chore: enforce cross-platform repository formatting"
```

---

### Task 2: Fix mobile action routing and queue controls

**Files:**

- Create: `apps/web/src/lib/findings/action.ts`
- Create: `apps/web/src/lib/findings/action.test.ts`
- Create: `apps/web/src/lib/findings/sort.ts`
- Create: `apps/web/src/lib/findings/sort.test.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `tests/e2e/workspace.spec.ts`

**Interfaces:**

- Consumes: `Finding` and `FindingState` from `apps/web/src/data.ts`.
- Produces:
  - `resolveFindingAction(finding: Finding): FindingAction`
  - `sortFindings(findings: Finding[], sort: QueueSort): Finding[]`
  - `QueueSort = "Priority" | "Newest" | "SLA"`

- [ ] **Step 1: Write failing pure-function tests**

Create `apps/web/src/lib/findings/action.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Finding } from "../../data";
import { resolveFindingAction } from "./action";

const base: Finding = {
  id: "SEC-2000",
  company: "Juniper Ridge Dental",
  title: "Example",
  severity: "High",
  state: "Needs remediation",
  owner: "M. Ortiz",
  age: "1h",
  source: "Manual",
  action: "Start remediation",
};

describe("resolveFindingAction", () => {
  it.each([
    ["Verification failed", { kind: "finding" }],
    ["Awaiting verification", { kind: "verification" }],
    ["Needs remediation", { kind: "page", page: "Remediation" }],
    ["Remediating", { kind: "page", page: "Remediation" }],
    ["Verified fixed", { kind: "page", page: "Evidence" }],
  ] as const)("maps %s consistently", (state, expected) => {
    expect(resolveFindingAction({ ...base, state })).toEqual(expected);
  });
});
```

Create `apps/web/src/lib/findings/sort.test.ts` with cases proving:

```ts
expect(sortFindings(findings, "Newest").map((f) => f.id)).toEqual([
  "SEC-1042",
  "SEC-1081",
  "SEC-1067",
  "SEC-1058",
  "SEC-1073",
]);

expect(sortFindings(findings, "SLA")[0]?.id).toBe("SEC-1058");
expect(sortFindings(findings, "Priority")[0]?.id).toBe("SEC-1042");
```

- [ ] **Step 2: Run the focused tests and confirm failure**

```powershell
npm test -w @remedence/web -- --run src/lib/findings/action.test.ts src/lib/findings/sort.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the action resolver**

Create `apps/web/src/lib/findings/action.ts`:

```ts
import type { Finding } from "../../data";

export type FindingAction =
  | { kind: "finding" }
  | { kind: "verification" }
  | { kind: "page"; page: "Remediation" | "Evidence" };

export function resolveFindingAction(finding: Finding): FindingAction {
  switch (finding.state) {
    case "Verification failed":
      return { kind: "finding" };
    case "Awaiting verification":
      return { kind: "verification" };
    case "Needs remediation":
    case "Remediating":
      return { kind: "page", page: "Remediation" };
    case "Verified fixed":
      return { kind: "page", page: "Evidence" };
  }
}
```

Use one `handleFindingAction` callback in `App.tsx` for both desktop and mobile rows. The callback opens the finding or verification drawer for those actions and navigates for page actions.

- [ ] **Step 4: Implement owner filtering and sort state**

Add controlled state in `App.tsx`:

```ts
const [ownerFilter, setOwnerFilter] = useState("All owners");
const [queueSort, setQueueSort] = useState<QueueSort>("Priority");
```

Update the memoized queue:

```ts
const filteredFindings = useMemo(() => {
  const filtered = effectiveFindings.filter((finding) => {
    const matchesOwner =
      ownerFilter === "All owners" || finding.owner === ownerFilter;
    return (
      matchesQuery &&
      matchesCompany &&
      matchesState &&
      matchesSeverity &&
      matchesOwner
    );
  });
  return sortFindings(filtered, queueSort);
}, [
  effectiveFindings,
  query,
  companyFilter,
  stateFilter,
  severityFilter,
  ownerFilter,
  queueSort,
]);
```

`sortFindings` parses `h` and `d` ages into hours, keeps failed verification first for Priority, places breached SLA first for SLA, and returns a copied array.

Wire both desktop and mobile filter controls to `ownerFilter`, `queueSort`, `setOwnerFilter`, and `setQueueSort`.

- [ ] **Step 5: Add browser regressions**

Add Playwright cases that:

1. Resize to `430×932`.
2. Click `Start remediation` for SEC-1058.
3. Assert heading `Remediation`, not dialog `Verify fix`.
4. Return to Dashboard.
5. Choose owner `S. Patel` and assert only SEC-1073 is shown.
6. Choose sort `Newest` and assert SEC-1042 precedes SEC-1081.

- [ ] **Step 6: Run tests**

```powershell
npm test -w @remedence/web
npm run e2e -- --grep "mobile action|owner|sort"
```

Expected: all focused tests pass.

- [ ] **Step 7: Commit and review**

```powershell
git add apps/web/src tests/e2e/workspace.spec.ts
git commit -m "fix(web): align finding actions and queue controls"
codex review --commit HEAD "Review mobile and desktop action parity, filter correctness, sort determinism, and regression coverage."
```

Fix every P1 and P2 review finding before continuing.

---

### Task 3: Fix duplicate imports, global search, and resolved notifications

**Files:**

- Create: `apps/web/src/lib/findings/search.ts`
- Create: `apps/web/src/lib/findings/search.test.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `tests/e2e/workspace.spec.ts`

**Interfaces:**

- Consumes: current local `Finding[]` and `CompanyRiskRow[]`.
- Produces:
  - `normalizeFindingKey(value: string): string`
  - `searchWorkspace(query: string, findings: Finding[], companies: CompanyRiskRow[]): WorkspaceSearchResult[]`

```ts
export interface CompanyRiskRow {
  company: string;
  risk: number;
  band: string;
  open: number;
  awaiting: number;
  failed: number;
}

export interface WorkspaceSearchResult {
  kind: "finding" | "company";
  id: string;
  primary: string;
  secondary: string;
}
```

- [ ] **Step 1: Write failing duplicate and search tests**

Add a unit test that opens Import findings, enters `sec-1042`, and expects:

```text
SEC-1042 already exists in this workspace. Use a different finding ID.
```

Add `search.test.ts` proving `sec-1042`, `juniper`, `semgrep`, and `L. Chen` match SEC-1042 and that blank queries return an empty result list.

- [ ] **Step 2: Run focused tests and confirm failure**

```powershell
npm test -w @remedence/web -- --run src/App.test.tsx src/lib/findings/search.test.ts
```

Expected: duplicate import is accepted and search module is absent.

- [ ] **Step 3: Implement normalized uniqueness**

Create:

```ts
export function normalizeFindingKey(value: string): string {
  return value.trim().toLocaleUpperCase("en-US");
}
```

Pass the current finding keys into `ImportDialog`. Before `onImport`, reject when:

```ts
const normalizedId = normalizeFindingKey(id);
if (existingIds.some((value) => normalizeFindingKey(value) === normalizedId)) {
  setError(
    `${normalizedId} already exists in this workspace. Use a different finding ID.`,
  );
  return;
}
```

Store the normalized ID in the new record.

- [ ] **Step 4: Implement visible global search results**

Create a `WorkspaceSearchPanel` below the top bar when the global search query is non-empty. Each result includes finding key, title, company, state, and an explicit `Open finding` button. Company matches include an explicit `Open company` button.

The panel uses:

```ts
interface WorkspaceSearchResult {
  kind: "finding" | "company";
  id: string;
  primary: string;
  secondary: string;
}
```

Search fields are finding key, title, company, source, owner, and company name. Escape closes the panel without clearing the query. Clicking a finding uses the shared finding action handler.

- [ ] **Step 5: Resolve notification state consistently**

Replace the fixed notification body with a derived array:

```ts
const notifications = verificationPassed
  ? [
      {
        id: "sla-breaches",
        title: "4 findings are past their remediation SLA.",
        status: "attention" as const,
      },
      {
        id: "sec-1042-resolved",
        title: "SEC-1042 verified fixed. Evidence bundle locked.",
        status: "resolved" as const,
      },
    ]
  : [
      {
        id: "sec-1042-failed",
        title:
          "SEC-1042 verification failed. Secondary query path remains exploitable.",
        status: "attention" as const,
      },
      {
        id: "sla-breaches",
        title: "4 findings are past their remediation SLA.",
        status: "attention" as const,
      },
    ];
```

The unread label counts only `attention` items. Status text and icons accompany color.

- [ ] **Step 6: Add Playwright regressions**

Cover:

- Importing `sec-1042` produces the written duplicate message and keeps one SEC-1042 row.
- Searching `semgrep` from the Remediation page exposes SEC-1042 as a result.
- Completing verification removes the failed notification and shows the resolved notification.

- [ ] **Step 7: Verify and commit**

```powershell
npm test -w @remedence/web
npm run e2e -- --grep "duplicate|global search|notification"
git add apps/web/src tests/e2e/workspace.spec.ts
git commit -m "fix(web): make workspace search and status consistent"
```

---

### Task 4: Add an accessible shared dialog layer

**Files:**

- Create: `apps/web/src/lib/dialogs/useDialogFocus.ts`
- Create: `apps/web/src/lib/dialogs/useDialogFocus.test.tsx`
- Create: `apps/web/src/lib/dialogs/DialogLayer.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/app.css`
- Modify: `tests/e2e/workspace.spec.ts`

**Interfaces:**

- Produces `useDialogFocus(options: DialogFocusOptions): void` and `DialogLayer`.

```ts
export interface DialogFocusOptions {
  open: boolean;
  dialogRef: React.RefObject<HTMLElement | null>;
  backgroundRef: React.RefObject<HTMLElement | null>;
  triggerRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}

export interface DialogLayerProps {
  labelledBy: string;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  backgroundRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  className: string;
}
```

- [ ] **Step 1: Write failing focus-containment tests**

Render a test dialog with first and last buttons. Assert:

```ts
await user.tab();
expect(lastButton).toHaveFocus();
await user.tab();
expect(firstButton).toHaveFocus();
await user.tab({ shift: true });
expect(lastButton).toHaveFocus();
```

Also assert the background root has `inert`, Escape invokes `onClose`, and closing restores focus to the trigger.

- [ ] **Step 2: Run the focused test and confirm failure**

```powershell
npm test -w @remedence/web -- --run src/lib/dialogs/useDialogFocus.test.tsx
```

Expected: FAIL because no shared dialog layer exists.

- [ ] **Step 3: Implement the hook**

Use this focusable selector:

```ts
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");
```

On open:

- Set `background.inert = true`.
- Focus `[data-dialog-initial-focus]` or the first focusable element.
- Trap Tab and Shift+Tab.
- Close on Escape.
- On cleanup, clear inert and focus the saved trigger in `requestAnimationFrame`.

- [ ] **Step 4: Wrap all overlays**

Move the application shell into a background wrapper and render drawers and dialogs as siblings. Replace repeated overlay behavior with `DialogLayer`. Keep each existing accessible name and visible close button.

- [ ] **Step 5: Add Playwright focus tests**

Open each overlay, press Tab at least one more time than its focusable-control count, and prove focus remains inside. Press Escape and prove focus returns to the activating control.

- [ ] **Step 6: Verify and commit**

```powershell
npm test -w @remedence/web
npm run e2e -- --grep "focus|Escape|inert"
git add apps/web/src tests/e2e/workspace.spec.ts
git commit -m "fix(web): contain modal focus and background input"
```

- [ ] **Step 7: Run the post-v1 Codex checkpoint review**

```powershell
$base = git rev-parse 0367501
$head = git rev-parse HEAD
codex review --base 0367501 "Verify that all six platform findings from the prior review are fixed without regressions. Focus on mobile actions, duplicates, filters, sorting, modal focus, notifications, and global search."
```

Fix every P1 and P2 issue. Record remaining P3 observations in the PR description rather than silently expanding scope.

---

### Task 5: Establish the API and domain workspace build graph

**Files:**

- Create: `.nvmrc`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/config.ts`
- Create: `apps/api/test/health.test.ts`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/database/package.json`
- Create: `packages/database/tsconfig.json`
- Create: `packages/database/src/index.ts`
- Create: `packages/evidence/package.json`
- Create: `packages/evidence/tsconfig.json`
- Create: `packages/evidence/src/index.ts`
- Create: `packages/verification/package.json`
- Create: `packages/verification/tsconfig.json`
- Create: `packages/verification/src/index.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Produces `createApp(): Express` and a compiled API process.
- Produces workspace packages with ESM exports from `dist/index.js` and declarations from `dist/index.d.ts`.

- [ ] **Step 1: Create workspace manifests and empty source entrypoints**

Create `apps/api/package.json`:

```json
{
  "name": "@remedence/api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/server.js",
  "types": "dist/server.d.ts",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -b",
    "test": "vitest run",
    "typecheck": "tsc -b --pretty false"
  }
}
```

Create package manifests for `@remedence/core`, `@remedence/database`, `@remedence/evidence`, and `@remedence/verification` with `type: "module"`, `main: "dist/index.js"`, `types: "dist/index.d.ts"`, and `build`, `test`, and `typecheck` scripts using `tsc -b` and `vitest run`. Create each listed `src/index.ts` exporting an empty object so workspace discovery succeeds before dependency installation.

- [ ] **Step 2: Write a failing health test**

Create `apps/api/test/health.test.ts`:

```ts
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("GET /healthz", () => {
  it("returns local process readiness without paths", async () => {
    const response = await request(createApp()).get("/healthz").expect(200);
    expect(response.body).toEqual({
      status: "ok",
      database: "not-configured",
      schema_version: 0,
    });
    expect(JSON.stringify(response.body)).not.toMatch(/[A-Z]:\\|\/home\//);
  });
});
```

- [ ] **Step 3: Install exact initial API dependencies**

Run:

```powershell
npm install -w apps/api express@5.2.1
npm install -D -w apps/api @types/express@5.0.6 supertest@7.2.2 @types/supertest@7.2.1 vitest@4.1.11 tsx@4.23.12
npm install -D @types/node@24.13.3
```

- [ ] **Step 4: Add TypeScript project references**

`tsconfig.base.json` must include:

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "skipLibCheck": false
  }
}
```

Root `tsconfig.json` references core, evidence, verification, database, and API. Each package emits to `dist` and uses `rootDir: "src"`.

- [ ] **Step 5: Implement the minimal health application**

`apps/api/src/app.ts`:

```ts
import express, { type Express } from "express";

export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.get("/healthz", (_request, response) => {
    response.json({
      status: "ok",
      database: "not-configured",
      schema_version: 0,
    });
  });
  return app;
}
```

`server.ts` listens on `127.0.0.1` and a configured port, with no remote-host override.

- [ ] **Step 6: Run focused and build tests**

```powershell
npm test -w @remedence/api
npx tsc -b
```

Expected: health test passes and all new workspace packages compile.

- [ ] **Step 7: Commit**

```powershell
git add .nvmrc tsconfig*.json package*.json apps/api packages/core packages/database packages/evidence packages/verification
git commit -m "feat(api): establish local API workspace"
```

---

### Task 6: Expand the OpenAPI contract and generate browser types

**Files:**

- Modify: `api/openapi.yaml`
- Create: `tests/contract/openapi.test.ts`
- Create: `scripts/check-generated-api.mjs`
- Create: `apps/web/src/lib/api/schema.d.ts`
- Create: `apps/web/src/lib/api/client.ts`
- Modify: `apps/web/package.json`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Produces operation IDs:
  - `getDashboard`
  - `listFindings`
  - `getFinding`
  - `createImport`
  - `createRemediation`
  - `completeRemediation`
  - `createVerification`
  - `createVerificationCheck`
  - `completeVerification`
  - `listEvidence`
  - `getEvidence`
  - `createReport`
  - `getReport`
  - `downloadReport`
  - `listAuditEvents`

- [ ] **Step 1: Write a failing contract test**

Create `tests/contract/openapi.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const document = parse(readFileSync("api/openapi.yaml", "utf8"));

const requiredOperations = [
  "getDashboard",
  "completeRemediation",
  "createVerificationCheck",
  "completeVerification",
  "downloadReport",
  "listAuditEvents",
];

describe("OpenAPI contract", () => {
  it("is OpenAPI 3.1 and contains the persistent workflow operations", () => {
    expect(document.openapi).toBe("3.1.0");
    const operationIds = Object.values(document.paths).flatMap((path: any) =>
      Object.values(path)
        .filter((operation: any) => operation?.operationId)
        .map((operation: any) => operation.operationId),
    );
    expect(operationIds).toEqual(expect.arrayContaining(requiredOperations));
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });
});
```

- [ ] **Step 2: Install contract tooling**

```powershell
npm install -D openapi-typescript@7.13.0 yaml@2.9.0
npm install -w @remedence/web openapi-fetch@0.17.0
```

- [ ] **Step 3: Update `api/openapi.yaml` before handlers**

Add the paths and schemas from the design spec. Every object request schema sets `additionalProperties: false`. Every error response uses `application/problem+json` and `Problem`. `page_size` has `minimum: 1`, `maximum: 100`, and default `25`.

The verification completion request uses this shape:

```yaml
CompleteVerificationRequest:
  type: object
  additionalProperties: false
  required: [result, summary]
  properties:
    result:
      type: string
      enum: [Passed, Failed]
    summary:
      type: string
      minLength: 1
      maxLength: 2000
    evidence:
      type: array
      maxItems: 25
      items:
        $ref: "#/components/schemas/CreateEvidenceItem"
```

- [ ] **Step 4: Generate types and a typed client**

Add root scripts:

```json
{
  "scripts": {
    "generate:api": "openapi-typescript api/openapi.yaml -o apps/web/src/lib/api/schema.d.ts",
    "check:generated-api": "node scripts/check-generated-api.mjs"
  }
}
```

`client.ts`:

```ts
import createClient from "openapi-fetch";
import type { paths } from "./schema";

export const api = createClient<paths>({ baseUrl: "/api/v1" });
```

`check-generated-api.mjs` generates to a temporary file, compares bytes with the committed file, and exits nonzero with `Run npm run generate:api` when different.

- [ ] **Step 5: Run tests**

```powershell
npm run generate:api
npx vitest run tests/contract/openapi.test.ts
npm run check:generated-api
npm run typecheck
```

- [ ] **Step 6: Commit**

```powershell
git add api/openapi.yaml tests/contract scripts/check-generated-api.mjs apps/web/src/lib/api apps/web/package.json package.json package-lock.json
git commit -m "feat(api): define persistent workflow contract"
```

---

### Task 7: Implement domain entities, state transitions, and priority

**Files:**

- Create: `packages/core/src/domain/entities.ts`
- Create: `packages/core/src/domain/finding-state.ts`
- Create: `packages/core/src/domain/priority.ts`
- Create: `packages/core/src/errors/domain-error.ts`
- Create: `packages/core/src/ports/repositories.ts`
- Create: `packages/core/src/ports/runtime.ts`
- Create: `packages/core/test/finding-state.test.ts`
- Create: `packages/core/test/priority.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Produces `Finding`, `Remediation`, `VerificationRun`, `VerificationCheck`, `EvidenceItem`, `Report`, `AuditEvent`.
- Produces `assertFindingTransition(from, to): void`.
- Produces `compareFindingPriority(left, right): number`.
- Produces repository ports named in `ports/repositories.ts`.

- [ ] **Step 1: Write failing transition tests**

Cover this exact matrix:

```ts
const allowed = [
  ["Needs remediation", "Remediating"],
  ["Verification failed", "Remediating"],
  ["Remediating", "Awaiting verification"],
  ["Awaiting verification", "Verification failed"],
  ["Awaiting verification", "Verified fixed"],
] as const;
```

Also prove these transitions throw `DomainError` with code `INVALID_FINDING_TRANSITION`:

```text
Needs remediation → Verified fixed
Remediating → Verified fixed
Verified fixed → Remediating
```

- [ ] **Step 2: Write failing priority tests**

Build findings with fixed UTC dates and assert this order:

```text
failed verification
critical awaiting verification
SLA breached
high needs remediation
remaining open
verified fixed
```

Tie-break by SLA due time, detected time, then finding key.

- [ ] **Step 3: Implement domain entities**

Use string unions from the OpenAPI contract. Domain timestamps are strings validated at boundaries. Each entity contains internal IDs and public finding keys separately.

Define `DomainError`:

```ts
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 404 | 409,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
```

- [ ] **Step 4: Define repository ports**

Define these shared query and repository types:

```ts
export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface FindingQuery {
  organizationId: string;
  search?: string;
  companyId?: string;
  state?: FindingState;
  severity?: Severity;
  owner?: string;
  sort: "priority" | "newest" | "sla";
  includeVerified: boolean;
  page: number;
  pageSize: number;
}

export interface DashboardFinding extends Finding {
  companyName: string;
  slaBreached: boolean;
  priorityBucket: number;
}

export interface FindingDetail {
  finding: Finding;
  company: Company;
  remediations: Remediation[];
  verifications: Array<VerificationRun & { checks: VerificationCheck[] }>;
  evidence: EvidenceItem[];
  auditEvents: AuditEvent[];
}

export interface FindingRepository {
  findByKey(organizationId: string, findingKey: string): Finding | undefined;
  list(query: FindingQuery): Page<DashboardFinding>;
  getDetail(
    organizationId: string,
    findingKey: string,
  ): FindingDetail | undefined;
  insert(finding: Finding): void;
  updateState(id: string, state: FindingState, updatedAt: string): void;
}

export interface RepositorySet {
  companies: CompanyRepository;
  findings: FindingRepository;
  remediations: RemediationRepository;
  verifications: VerificationRepository;
  evidence: EvidenceRepository;
  reports: ReportRepository;
  auditEvents: AuditEventRepository;
}

export interface UnitOfWork {
  run<T>(operation: (repositories: RepositorySet) => T): T;
}
```

Define the remaining ports with these signatures:

```ts
export interface CompanyRepository {
  getById(organizationId: string, companyId: string): Company | undefined;
  list(organizationId: string): Company[];
  insert(company: Company): void;
}

export interface RemediationRepository {
  getById(id: string): Remediation | undefined;
  listByFinding(findingId: string): Remediation[];
  insert(remediation: Remediation): void;
  complete(
    id: string,
    summary: string,
    reference: string,
    completedAt: string,
    updatedAt: string,
  ): void;
}

export interface VerificationRepository {
  getById(id: string): VerificationRun | undefined;
  listByFinding(findingId: string): VerificationRun[];
  insert(run: VerificationRun): void;
  insertCheck(check: VerificationCheck): void;
  listChecks(verificationId: string): VerificationCheck[];
  complete(
    id: string,
    status: "Passed" | "Failed",
    summary: string,
    completedAt: string,
  ): void;
}

export interface EvidenceQuery {
  organizationId: string;
  findingId?: string;
  verificationId?: string;
  locked?: boolean;
}

export interface EvidenceRepository {
  getById(organizationId: string, evidenceId: string): EvidenceItem | undefined;
  list(query: EvidenceQuery): EvidenceItem[];
  insert(item: EvidenceItem): void;
}

export interface ReportRepository {
  getById(organizationId: string, reportId: string): Report | undefined;
  listByCompany(organizationId: string, companyId: string): Report[];
  insert(report: Report): void;
}

export interface AuditEventQuery {
  organizationId: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export interface AuditEventRepository {
  append(event: AuditEvent): void;
  list(query: AuditEventQuery): Page<AuditEvent>;
}

export interface Clock {
  now(): string;
}

export interface IdGenerator {
  next(): string;
}
```

- [ ] **Step 5: Run tests and commit**

```powershell
npm test -w @remedence/core
npx tsc -b packages/core
git add packages/core
git commit -m "feat(core): define remediation state rules"
```

---

### Task 8: Implement SQLite migrations and safe database lifecycle

**Files:**

- Create: `packages/database/migrations/0001_initial.sql`
- Create: `packages/database/src/database.ts`
- Create: `packages/database/src/migrations.ts`
- Create: `packages/database/src/transaction.ts`
- Create: `packages/database/test/database.test.ts`
- Modify: `packages/database/src/index.ts`

**Interfaces:**

- Produces `openRemedenceDatabase(options): RemedenceDatabase`.
- Produces `applyMigrations(database, migrationsDirectory): number`.
- Produces `runTransaction<T>(database, operation): T`.

```ts
export interface OpenDatabaseOptions {
  path: string;
  readOnly?: boolean;
}

export interface RemedenceDatabase {
  readonly path: string;
  readonly connection: DatabaseSync;
  schemaVersion: number;
  close(): void;
}
```

`RemedenceDatabase.connection` remains internal to `packages/database`; it is not re-exported from the package root.

- [ ] **Step 1: Write failing database tests**

Tests use a unique temporary directory and prove:

- Opening creates the database file.
- Foreign keys reject an invalid company organization.
- Migrations create `schema_migrations` and reach version `1`.
- Running migrations twice remains at version `1`.
- A thrown transaction rolls back all writes.
- Extension loading remains disabled.

- [ ] **Step 2: Create the initial strict schema**

`0001_initial.sql` creates the tables from the spec using `STRICT` tables. Use `TEXT COLLATE NOCASE` on `finding_key` and this uniqueness rule:

```sql
CREATE UNIQUE INDEX findings_organization_key_unique
ON findings (organization_id, finding_key COLLATE NOCASE);
```

Use foreign keys with `ON DELETE RESTRICT` for evidence and audit history. Add indexes for queue filters, verification history, evidence lookup, report company and generation time, and audit entity ordering.

- [ ] **Step 3: Implement safe open behavior**

`database.ts` uses:

```ts
const database = new DatabaseSync(path, {
  timeout: 5_000,
  enableForeignKeyConstraints: true,
  enableDoubleQuotedStringLiterals: false,
  allowUnknownNamedParameters: false,
  allowExtension: false,
  defensive: true,
});

database.exec("PRAGMA journal_mode = WAL");
database.exec("PRAGMA synchronous = NORMAL");
database.limits.sqlLength = 1_000_000;
database.limits.variableNumber = 500;
database.limits.exprDepth = 100;
database.limits.attach = 0;
```

Expose `close()`, `schemaVersion`, and the underlying connection only to database package internals.

- [ ] **Step 4: Implement transactional migrations**

Read migration files by numeric prefix. For each unapplied migration:

```text
BEGIN IMMEDIATE
→ execute SQL
→ insert schema_migrations row
→ COMMIT
```

On error, issue `ROLLBACK` and rethrow with the migration filename.

- [ ] **Step 5: Verify and commit**

```powershell
npm test -w @remedence/database -- --run test/database.test.ts
npx tsc -b packages/database
git add packages/database
git commit -m "feat(database): add durable SQLite schema"
```

---

### Task 9: Implement read repositories and idempotent seed data

**Files:**

- Create: `packages/database/src/rows.ts`
- Create: `packages/database/src/repositories/company-repository.ts`
- Create: `packages/database/src/repositories/finding-repository.ts`
- Create: `packages/database/src/repositories/audit-event-repository.ts`
- Create: `packages/database/src/seed.ts`
- Create: `packages/database/test/seed.test.ts`
- Create: `packages/database/test/finding-repository.test.ts`
- Modify: `packages/database/src/index.ts`

**Interfaces:**

- Implements `CompanyRepository`, `FindingRepository`, and `AuditEventRepository` from core.
- Produces `seedHarborline(database, runtime): { applied: boolean }`.

- [ ] **Step 1: Write failing seed tests**

Prove:

- Empty database seeds one organization and twelve companies.
- SEC-1042 is `Verification failed`.
- SEC-1042 has one failed verification and one completed remediation.
- Running seed twice does not duplicate rows.
- Seeding a database with an existing organization returns `{ applied: false }`.

- [ ] **Step 2: Write failing repository query tests**

Cover case-insensitive finding-key lookup, search across key/title/company/source/owner/asset, owner filtering, state filtering, severity filtering, page size maximum, and deterministic priority order.

- [ ] **Step 3: Implement row mappers**

Every query selects explicit columns. Do not use `SELECT *`. Mapping functions validate required columns and convert integer booleans to booleans.

- [ ] **Step 4: Implement parameterized read queries**

Build filters from an allowlisted set. SQL order fragments come only from this map:

```ts
const SORT_SQL = {
  priority:
    "priority_bucket ASC, sla_due_at ASC, detected_at ASC, finding_key ASC",
  newest: "detected_at DESC, finding_key ASC",
  sla: "sla_breached DESC, sla_due_at ASC, finding_key ASC",
} as const;
```

User input is never interpolated into the SQL string.

- [ ] **Step 5: Implement the Harborline seed transaction**

Use fixed IDs and timestamps so tests are deterministic. Insert the approved dataset, failed SEC-1042 verification, completed remediation, verification checks, evidence for already-verified SEC-1073, report draft, and matching audit events.

- [ ] **Step 6: Verify and commit**

```powershell
npm test -w @remedence/database -- --run test/seed.test.ts test/finding-repository.test.ts
git add packages/database
git commit -m "feat(database): persist Harborline read models"
```

---

### Task 10: Implement mutation repositories and domain services

**Files:**

- Create: `packages/database/src/repositories/remediation-repository.ts`
- Create: `packages/database/src/repositories/verification-repository.ts`
- Create: `packages/database/src/repositories/evidence-repository.ts`
- Create: `packages/database/src/repositories/report-repository.ts`
- Create: `packages/database/src/unit-of-work.ts`
- Create: `packages/evidence/src/index.ts`
- Create: `packages/verification/src/index.ts`
- Create: `packages/core/src/services/import-finding.ts`
- Create: `packages/core/src/services/remediation-service.ts`
- Create: `packages/core/src/services/verification-service.ts`
- Create: `packages/core/src/services/dashboard-service.ts`
- Create: `packages/core/src/services/report-service.ts`
- Create: `packages/core/test/services.test.ts`
- Create: `packages/database/test/workflow.test.ts`

**Interfaces:**

- Produces service methods:
  - `importFinding(input): ImportResult`
  - `startRemediation(input): Remediation`
  - `completeRemediation(input): Remediation`
  - `startVerification(input): VerificationRun`
  - `recordVerificationCheck(input): VerificationCheck`
  - `completeVerification(input): VerificationCompletion`
  - `getDashboard(query): DashboardSnapshot`
  - `createReport(input): Report`

```ts
export interface ImportResult {
  importRecord: ImportRecord;
  finding: Finding;
}

export interface VerificationCompletion {
  verification: VerificationRun;
  finding: Finding;
  evidence: EvidenceItem[];
}

export interface DashboardMetrics {
  managedCompanies: number;
  openFindings: number;
  awaitingVerification: number;
  verificationFailed: number;
  verifiedFixed: number;
  slaBreaches: number;
}

export interface DashboardSnapshot {
  metrics: DashboardMetrics;
  actionQueue: DashboardFinding[];
  companies: CompanyRiskSummary[];
  verificationActivity: VerificationActivity[];
  notifications: NotificationItem[];
  latestReport?: Report;
}
```

Define `CompanyRiskSummary`, `VerificationActivity`, `NotificationItem`, and `ImportRecord` in `entities.ts` with the exact fields returned by the OpenAPI schemas created in Task 6.

- [ ] **Step 1: Write failing domain service tests with in-memory fakes**

Cover:

- Case-insensitive duplicate import throws `DUPLICATE_FINDING` with status 409.
- Starting remediation from `Needs remediation` succeeds.
- Starting remediation from `Awaiting verification` fails.
- Completing remediation transitions to `Awaiting verification`.
- Starting verification requires completed remediation.
- Passed verification rejects pending or failed required checks.
- Failed verification requires a nonblank summary.
- Passed verification records locked evidence and keeps previous failure history.

- [ ] **Step 2: Implement evidence hashing**

`packages/evidence/src/index.ts` exports:

```ts
export interface EvidenceHashInput {
  kind: string;
  label: string;
  sourceReference: string;
  metadata: Record<string, unknown>;
}

export function hashEvidenceMetadata(input: EvidenceHashInput): string {
  const canonical = JSON.stringify({
    kind: input.kind,
    label: input.label,
    source_reference: input.sourceReference,
    metadata: sortObjectKeys(input.metadata),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
```

Reject mutation of any evidence item with a non-null `lockedAt`.

- [ ] **Step 3: Implement services against ports**

Services receive `UnitOfWork`, `Clock`, and `IdGenerator` through constructors. They contain no SQL and no HTTP response knowledge.

The passed-verification transaction performs this exact sequence:

```text
load finding and run
→ validate state and checks
→ insert evidence with content hashes and locked_at
→ mark verification Passed
→ update finding Verified fixed
→ append verification.completed audit event
→ append evidence.locked audit event
→ return completion
```

- [ ] **Step 4: Implement SQLite mutation adapters**

Use prepared statements and verify `changes === 1` for expected single-row updates. A zero-change update throws `DomainError("CONCURRENT_STATE_CHANGE", 409, ...)`.

- [ ] **Step 5: Prove transaction rollback**

Inject an evidence repository failure after the verification update is attempted. Assert the verification, finding, evidence, and audit rows all remain unchanged.

- [ ] **Step 6: Verify and commit**

```powershell
npm test -w @remedence/core
npm test -w @remedence/database -- --run test/workflow.test.ts
npx tsc -b packages/core packages/evidence packages/verification packages/database
git add packages/core packages/database packages/evidence packages/verification
git commit -m "feat(core): persist remediation verification and evidence"
```

- [ ] **Step 7: Request checkpoint code review**

```powershell
codex review --base HEAD~3 "Review domain boundaries, state-transition correctness, SQL injection resistance, transaction atomicity, locked evidence behavior, and audit completeness."
```

Fix every P1 and P2 issue before creating HTTP routes.

---

### Task 11: Implement API composition, problems, dashboard, findings, and imports

**Files:**

- Create: `apps/api/src/dependencies.ts`
- Create: `apps/api/src/middleware/request-context.ts`
- Create: `apps/api/src/middleware/problem-handler.ts`
- Create: `apps/api/src/routes/dashboard.ts`
- Create: `apps/api/src/routes/companies.ts`
- Create: `apps/api/src/routes/findings.ts`
- Create: `apps/api/src/routes/imports.ts`
- Create: `apps/api/test/read-import.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Produces `createApp(dependencies: ApiDependencies): Express`.
- Produces `createDependencies(config): ApiDependencies`.
- API responses conform to generated OpenAPI schemas.

```ts
export interface ApiDependencies {
  services: {
    dashboard: DashboardService;
    imports: ImportFindingService;
    remediation: RemediationService;
    verification: VerificationService;
    reports: ReportService;
  };
  repositories: RepositorySet;
  health: () => { database: "ready"; schemaVersion: number };
  log: (entry: Record<string, unknown>) => void;
}
```

- [ ] **Step 1: Write failing API tests**

Using a temporary database and Supertest, prove:

- `GET /healthz` reports `database: "ready"` and schema `1`.
- `GET /api/v1/dashboard` returns metrics `12, 47, 8, 3, 126, 4` from seed rows.
- `GET /api/v1/findings?owner=S. Patel` returns SEC-1073 only.
- `GET /api/v1/findings?sort=newest` is deterministic.
- `POST /api/v1/imports` creates a finding and audit event.
- A case-variant duplicate returns `409 application/problem+json` with code `DUPLICATE_FINDING`.
- Invalid severity returns OpenAPI `400`.
- A JSON body over 256 KiB returns `413`.
- Every response has `X-Request-ID`.

- [ ] **Step 2: Install validator dependencies**

```powershell
npm install -w @remedence/api express-openapi-validator@5.6.2 yaml@2.9.0
```

- [ ] **Step 3: Implement request context**

Accept a caller-supplied `X-Request-ID` only when it matches `^[A-Za-z0-9._-]{1,80}$`; otherwise generate `randomUUID()`. Record method, path, status, and duration as one JSON log line after response completion.

- [ ] **Step 4: Install OpenAPI validation in the correct order**

`app.ts` middleware order:

```text
request context
→ express.json({ limit: "256kb", type: "application/json" })
→ health route
→ OpenAPI validator
→ API routes
→ problem handler
```

Enable request validation and JSON response validation. Disable `x-powered-by`.

- [ ] **Step 5: Implement problem conversion**

Map:

- `DomainError` to its status and code.
- OpenAPI validation errors to 400 and code `INVALID_REQUEST`.
- Express entity-too-large to 413 and code `REQUEST_TOO_LARGE`.
- Unexpected errors to 500 and code `INTERNAL_ERROR`.

Do not include stack traces, environment values, or database paths.

- [ ] **Step 6: Implement thin routes**

Route handlers parse already-validated values, call one service method, set status and headers, and return. No SQL or state transitions belong in routes.

- [ ] **Step 7: Verify and commit**

```powershell
npm test -w @remedence/api -- --run test/read-import.test.ts
npm run check:generated-api
npx tsc -b
git add apps/api package-lock.json
git commit -m "feat(api): expose dashboard findings and imports"
```

---

### Task 12: Implement remediation, verification, and evidence routes

**Files:**

- Create: `apps/api/src/routes/remediations.ts`
- Create: `apps/api/src/routes/verifications.ts`
- Create: `apps/api/src/routes/evidence.ts`
- Create: `apps/api/test/verification-workflow.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**

- Implements the remediation, verification, and evidence operation IDs from Task 6.

- [ ] **Step 1: Write a failing end-to-end API workflow test**

The test must:

1. Import SEC-2099.
2. Start remediation.
3. Complete remediation.
4. Start verification with three expected checks.
5. Record one passed and one failed check.
6. Complete as Failed with a summary.
7. Start a second remediation and complete it.
8. Start a second verification.
9. Record all checks Passed.
10. Complete as Passed with two evidence items.
11. Assert the finding is `Verified fixed`.
12. Assert both verification runs remain present.
13. Assert evidence rows have `locked_at` and 64-character SHA-256 hashes.
14. Assert matching audit events exist.

- [ ] **Step 2: Run and confirm failure**

```powershell
npm test -w @remedence/api -- --run test/verification-workflow.test.ts
```

- [ ] **Step 3: Implement the routes**

Use the service methods from Task 10. Set `Location` headers on created resources. Return 409 for invalid state or duplicate check sequence.

- [ ] **Step 4: Verify response validation**

Add one test-only faulty service response and prove OpenAPI response validation rejects it rather than silently sending an invalid object.

- [ ] **Step 5: Run tests and commit**

```powershell
npm test -w @remedence/api
npm test -w @remedence/core
npm test -w @remedence/database
git add apps/api
git commit -m "feat(api): expose remediation verification and evidence"
```

---

### Task 13: Implement reports, audit reads, and backups

**Files:**

- Create: `apps/api/src/routes/reports.ts`
- Create: `apps/api/src/routes/audit-events.ts`
- Create: `apps/api/test/report-audit.test.ts`
- Create: `packages/database/src/backup.ts`
- Create: `packages/database/test/backup.test.ts`
- Create: `scripts/db-migrate.mjs`
- Create: `scripts/db-seed.mjs`
- Create: `scripts/db-backup.mjs`
- Modify: `apps/api/src/app.ts`
- Modify: `package.json`

**Interfaces:**

- Produces Markdown report downloads.
- Produces `backupDatabase(source, destination): Promise<void>`.

- [ ] **Step 1: Write failing report tests**

Prove:

- Creating a report returns 201 and an immutable snapshot.
- Creating a second report does not modify the first.
- Download returns `text/markdown; charset=utf-8`.
- `Content-Disposition` uses `attachment; filename="juniper-ridge-dental-august-security-review.md"`.
- Markdown contains risk score, verified fixes, failed verification history, and generated timestamp.
- Audit reads return increasing event IDs.

- [ ] **Step 2: Write failing backup tests**

Create a file-backed database, seed it, back it up, open the backup read-only, and assert Harborline and SEC-1042 are readable.

- [ ] **Step 3: Implement report rendering**

Use a pure core renderer that escapes Markdown table delimiters and never embeds HTML. Keep the snapshot JSON authoritative; the Markdown file is a presentation of that snapshot.

- [ ] **Step 4: Implement backup and operational scripts**

Use `backup()` from `node:sqlite`. Reject a destination inside the active database path and create parent directories safely. Scripts read only `REMEDENCE_DATA_DIR` and explicit command arguments.

Add scripts:

```json
{
  "scripts": {
    "db:migrate": "node scripts/db-migrate.mjs",
    "db:seed": "node scripts/db-seed.mjs",
    "db:backup": "node scripts/db-backup.mjs"
  }
}
```

- [ ] **Step 5: Verify and commit**

```powershell
npm test -w @remedence/api -- --run test/report-audit.test.ts
npm test -w @remedence/database -- --run test/backup.test.ts
git add apps/api packages/database packages/core scripts package.json
git commit -m "feat(reports): add durable snapshots audit and backup"
```

---

### Task 14: Replace web read models with the typed API client

**Files:**

- Create: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/app/AppShell.tsx`
- Create: `apps/web/src/features/dashboard/DashboardPage.tsx`
- Create: `apps/web/src/features/findings/FindingQueue.tsx`
- Create: `apps/web/src/features/shared/AsyncState.tsx`
- Create: `apps/web/src/lib/api/problems.ts`
- Create: `apps/web/src/lib/api/useApiQuery.ts`
- Create: `apps/web/src/test/fixtures.ts`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/app.css`
- Remove after migration: `apps/web/src/App.tsx`
- Remove after migration: `apps/web/src/data.ts`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/vite.config.ts`

**Interfaces:**

- Consumes `api` and generated `paths` from Task 6.
- Produces API-backed dashboard, queue, global search, filters, notifications, and secondary read pages.

```ts
export interface ApiProblem {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  request_id: string;
  errors?: Array<{ path: string; message: string }>;
}

export interface QueryState<T> {
  status: "idle" | "loading" | "success" | "error";
  data?: T;
  problem?: ApiProblem;
  reload: () => void;
}
```

- [ ] **Step 1: Write failing web API tests**

Mock `global.fetch` and prove:

- Dashboard renders server metrics rather than imported constants.
- Loading state contains visible text `Loading remediation workspace…`.
- Problem response renders title, detail, request ID, and `Retry`.
- Empty action queue explains why no findings match and offers `Clear filters`.
- URL query parameters initialize search, owner, severity, state, company, and sort.

- [ ] **Step 2: Add the Vite API proxy**

Development proxy:

```ts
server: {
  proxy: {
    "/api": "http://127.0.0.1:43180",
    "/healthz": "http://127.0.0.1:43180",
  },
}
```

- [ ] **Step 3: Implement a small query hook**

Do not add React Query. Implement:

```ts
export function useApiQuery<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  dependencies: React.DependencyList,
): QueryState<T>;
```

It exposes `idle | loading | success | error`, aborts the previous request with `AbortController` when dependencies change, ignores abort errors, and provides `reload()` through an internal request counter.

- [ ] **Step 4: Split the application along product boundaries**

Move the shell and dashboard components without changing the approved visual system. Keep shared action resolution and dialog layer from Tasks 2 and 4.

- [ ] **Step 5: Replace compiled data**

Remove production imports from `data.ts`. Tests may use fixtures under `src/test/fixtures.ts`. Dashboard calls `GET /dashboard`; finding detail and secondary pages call the corresponding endpoints.

- [ ] **Step 6: Preserve filters in the URL**

Use `URLSearchParams` and `history.replaceState`. The global search and queue filters reload the dashboard read model with API query parameters. Browser back and forward restore the view.

- [ ] **Step 7: Verify and commit**

```powershell
npm test -w @remedence/web
npm run typecheck
npm run build
git add apps/web
git commit -m "feat(web): consume persistent remediation read models"
```

---

### Task 15: Connect import, remediation, verification, evidence, and report mutations

**Files:**

- Create: `apps/web/src/features/imports/ImportFindingDialog.tsx`
- Create: `apps/web/src/features/remediation/RemediationPanel.tsx`
- Create: `apps/web/src/features/verification/VerificationDrawer.tsx`
- Create: `apps/web/src/features/evidence/EvidencePage.tsx`
- Create: `apps/web/src/features/reports/ReportDialog.tsx`
- Create: `apps/web/src/lib/api/useApiMutation.ts`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app.css`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `tests/e2e/workspace.spec.ts`

**Interfaces:**

- Uses the generated operation request and response types.
- Mutations invalidate dashboard and affected detail reads only after success.

- [ ] **Step 1: Write failing mutation tests**

Cover:

- Import sends normalized fields and handles 409 duplicate detail.
- Remediation start and complete use separate actions.
- Verification creates a run, records checks, then completes it.
- Failed completion displays the concrete reason.
- Passed completion displays `Verified fixed. Evidence bundle locked.`.
- Report generation creates a new snapshot and downloads the returned report URL.
- API errors keep entered form values and move focus to written error text.

- [ ] **Step 2: Implement `useApiMutation`**

Expose:

```ts
interface MutationState<T> {
  status: "idle" | "pending" | "success" | "error";
  data?: T;
  problem?: ApiProblem;
}
```

Prevent duplicate submissions while pending. Abort only when the component unmounts, not when focus changes.

- [ ] **Step 3: Implement real remediation flow**

`Start remediation` opens a panel with owner, summary, and reference. After creation, show the persisted remediation ID and explicit `Complete remediation` action. Completion refreshes the finding to `Awaiting verification`.

- [ ] **Step 4: Implement real verification flow**

The drawer sequence is:

```text
load finding detail
→ create verification run
→ render required checks as written rows
→ record each check result
→ complete Failed or Passed
→ refresh dashboard and detail
```

The default local flow records results supplied by the operator. Copy must say `Record independent verification result`, not claim that an automated worker executed.

- [ ] **Step 5: Implement evidence and reports**

Evidence page renders the source reference, content hash, verification ID, created timestamp, and locked timestamp in IBM Plex Mono. Report dialog generates a new snapshot and uses an ordinary link to the API download endpoint.

- [ ] **Step 6: Add full browser workflow tests**

Use a temporary database. Perform the SEC-1042 second verification in the browser, reload the page, and prove:

- SEC-1042 remains `Verified fixed`.
- Failed verification #1 remains in history.
- Passed verification #2 remains in history.
- Evidence is locked.
- Metrics are 46 open, 2 failed, and 127 verified fixed.

- [ ] **Step 7: Verify and commit**

```powershell
npm test -w @remedence/web
npm run e2e -- --grep "persistent|remediation|verification|evidence|report"
git add apps/web tests/e2e/workspace.spec.ts
git commit -m "feat(web): persist remediation and verification workflows"
```

---

### Task 16: Add production local mode and process-safe development scripts

**Files:**

- Create: `scripts/dev.mjs`
- Create: `.github/workflows/ci.yml`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/demo-workflow.md`
- Modify: `.gitignore`

**Interfaces:**

- Produces `npm run dev`, `npm run start`, and final `npm run check`.

- [ ] **Step 1: Write failing production smoke test**

Create an API integration test that builds the web app, starts the API on an ephemeral loopback port with a temporary data directory, requests `/`, `/assets/...`, `/healthz`, and `/api/v1/dashboard`, and expects HTTP 200 with correct content types.

- [ ] **Step 2: Serve built assets only in production**

After API routes, serve `apps/web/dist` with cache policy:

- Hashed assets: `public, max-age=31536000, immutable`.
- HTML: `no-cache`.
- Unknown `/api` paths remain JSON 404 problems.
- Unknown non-API browser paths return `index.html` for the local single-page application.

- [ ] **Step 3: Add process-safe development startup**

`scripts/dev.mjs` spawns API and web commands, prefixes written output with `[api]` and `[web]`, forwards SIGINT and SIGTERM, and exits nonzero when either child exits unexpectedly. It must not enumerate or kill unrelated Node processes.

- [ ] **Step 4: Finalize root scripts**

```json
{
  "scripts": {
    "dev": "node scripts/dev.mjs",
    "build": "tsc -b && npm run build -w @remedence/web",
    "start": "node --enable-source-maps apps/api/dist/server.js",
    "test": "npm run test --workspaces --if-present",
    "test:contract": "vitest run tests/contract",
    "typecheck": "tsc -b --pretty false && npm run typecheck -w @remedence/web",
    "lint": "oxlint apps packages scripts tests playwright.config.ts --deny-warnings",
    "format": "prettier --write . --ignore-unknown",
    "format:check": "prettier --check . --ignore-unknown",
    "e2e": "playwright test",
    "check": "npm run format:check && npm run lint && npm run typecheck && npm run test:contract && npm test && npm run build && npm run check:generated-api && npm run e2e"
  }
}
```

- [ ] **Step 5: Add Node.js 24 and 26 CI validation**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: [24.x, 26.x]
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run check
```

Add this engine range to root `package.json`:

```json
{
  "engines": {
    "node": ">=24.15.0 <27"
  }
}
```

- [ ] **Step 6: Document the trust boundary**

README must state:

```text
Remedence local v1 has no user authentication. It binds to 127.0.0.1 and must not be exposed directly to an untrusted network.
```

Document data directory, migration, seed, backup, start, and report commands. Remove statements that call the API or database future work.

- [ ] **Step 7: Ignore runtime artifacts**

Add:

```gitignore
data/
*.db
*.db-shm
*.db-wal
*.sqlite
*.sqlite3
backups/
```

- [ ] **Step 8: Verify and commit**

```powershell
npm run check
git add .github scripts apps/api package.json README.md docs .gitignore
git commit -m "feat: ship single-node persistent local mode"
```

---

### Task 17: Run real-browser persistence, accessibility, and performance pre-flight

**Files:**

- Modify: `playwright.config.ts`
- Modify: `tests/e2e/workspace.spec.ts`
- Create: `artifacts/` output only, ignored by git

**Interfaces:**

- Produces final validation evidence, screenshots, accessibility snapshots, and Lighthouse results.

- [ ] **Step 1: Configure isolated E2E services**

Playwright starts API and web with a unique temporary data directory and seed. Use bounded startup timeouts and reuse only processes started by the test command.

- [ ] **Step 2: Add restart persistence test**

Use a Node integration test to:

```text
start API A
→ import SEC-2099
→ stop API A gracefully
→ start API B with same data directory
→ GET SEC-2099
→ expect persisted record
```

- [ ] **Step 3: Validate required viewports**

Run desktop `1440×900`, desktop `1280×800`, tablet `1024×768`, mobile `430×932`, and mobile `390×844`. Assert no horizontal overflow and that the action queue remains understandable.

- [ ] **Step 4: Validate keyboard and dialog behavior**

Test skip link, tab order, visible focus, global search, all navigation destinations, drawers, dialogs, Escape, focus restoration, and background inertness.

- [ ] **Step 5: Validate 200 percent zoom and reduced motion in real Chrome**

Use Home Computer Use with a separate isolated Chrome process. Set browser zoom to 200 percent, inspect the product, and return zoom to 100 percent. Emulate reduced motion and verify the drawer remains understandable with animation removed.

- [ ] **Step 6: Inspect console, network, ARIA, and headings**

Reject:

- Browser console errors.
- Transport failures.
- Implementation-caused HTTP 4xx or 5xx responses.
- Broken image or font responses.
- Heading-order regressions.
- Missing accessible names.
- Serious axe violations.

- [ ] **Step 7: Run production Lighthouse**

Audit the production local build on desktop and mobile. Record Performance, Accessibility, Best Practices, SEO, FCP, LCP, CLS, and TBT. Fix actionable issues below the spec targets.

- [ ] **Step 8: Perform Design & Taste critique and refinement**

Review as somebody else's product. Fix weak mobile hierarchy, unnecessary cards, vague copy, status relying on color, inconsistent spacing, weak focus, clipped identifiers, and excessive whitespace. Run a second critique and final pre-flight.

- [ ] **Step 9: Capture final screenshots**

Capture Dashboard, failed verification history, passed verification result, Evidence, Report, mobile Dashboard, and 200 percent zoom states after refinement.

- [ ] **Step 10: Commit validation refinements**

```powershell
git add apps/web apps/api tests playwright.config.ts
git commit -m "fix(ux): refine persistent workflow preflight"
```

---

### Task 18: Final review, PR, merge, and documentation closeout

**Files:**

- Modify as findings require.
- Modify later in separate repositories: `remedence.github.io` and `.github` after this feature is live.

**Interfaces:**

- Produces merged persistent core v1 with evidence-backed validation.

- [ ] **Step 1: Inspect final repository state**

```powershell
git status --short --branch
git diff origin/main...HEAD --check
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

- [ ] **Step 2: Scan tracked changes**

Confirm no `.env`, database files, backups, logs, screenshots, local absolute paths, tokens, cookies, credentials, or personal files are tracked.

- [ ] **Step 3: Run final checks from a clean process state**

```powershell
npm ci
npm run check
```

Expected: all checks pass with no hidden warning suppression.

- [ ] **Step 4: Run final Codex review**

```powershell
codex review --base origin/main "Review the complete persistent local core v1 against docs/superpowers/specs/2026-08-20-persistent-local-core-v1-design.md. Prioritize security boundaries, state invariants, transaction atomicity, API contract fidelity, persistence, accessibility, and truthful product claims."
```

Fix all P1 and P2 findings. Re-run `npm run check` after fixes.

- [ ] **Step 5: Push and open PR**

```powershell
git push -u origin feat/persistent-local-core-v1
gh pr create --repo remedence/remedence --base main --head feat/persistent-local-core-v1 --title "feat: ship persistent local core v1" --body-file artifacts/pr-body.md
```

The PR body includes architecture, implemented workflows, test counts, Codex review results, Lighthouse results, security boundary, screenshots, and deferred work.

- [ ] **Step 6: Merge after validation**

Verify checks and merge without force push. Record merge SHA.

- [ ] **Step 7: Execute separate public-site repair and product-update plan**

Use `docs/superpowers/plans/2026-08-20-public-site-review-repairs.md` in `remedence.github.io`. Fix the breakpoint and HTTP-response tests first, then update truthful product copy and screenshots only after the persistent API merge is live.

- [ ] **Step 8: Update the organization profile**

On a separate `.github` branch, fix malformed symbols and keep the profile concise. Link only:

```text
https://remedence.github.io/
https://github.com/remedence/remedence
```

- [ ] **Step 9: Update Google Drive implementation status**

Append repository URLs, PR, merge SHA, validation date, Lighthouse results, major UX validation notes, and genuinely deferred work to Product + Business Spec v1 without replacing strategy content.
