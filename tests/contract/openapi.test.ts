import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface OpenApiOperation {
  operationId?: string;
}

interface OpenApiSchema {
  additionalProperties?: boolean;
  required?: string[];
}

interface OpenApiDocument {
  openapi?: string;
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
  };
}

const document = parse(
  readFileSync("api/openapi.yaml", "utf8"),
) as OpenApiDocument;

const requiredOperations = [
  "getDashboard",
  "listFindings",
  "getFinding",
  "createImport",
  "createRemediation",
  "completeRemediation",
  "createVerification",
  "createVerificationCheck",
  "completeVerification",
  "listEvidence",
  "getEvidence",
  "createReport",
  "getReport",
  "downloadReport",
  "listAuditEvents",
] as const;

const requiredPaths = [
  "/dashboard",
  "/companies",
  "/assets",
  "/findings",
  "/remediations",
  "/verifications",
  "/evidence",
  "/reports",
  "/imports",
  "/webhooks",
  "/integrations",
  "/audit-events",
] as const;

const mutationSchemas = [
  "CreateImportRequest",
  "CreateRemediationRequest",
  "CompleteRemediationRequest",
  "CreateVerificationRequest",
  "CreateVerificationCheckRequest",
  "CreateEvidenceItem",
  "CompleteVerificationRequest",
  "CreateReportRequest",
] as const;

describe("OpenAPI contract", () => {
  it("is OpenAPI 3.1 and contains the persistent workflow operations", () => {
    expect(document.openapi).toBe("3.1.0");

    const operationIds = Object.values(document.paths ?? {}).flatMap((path) =>
      Object.values(path)
        .filter((operation) => operation?.operationId)
        .map((operation) => operation.operationId),
    );

    expect(operationIds).toEqual(expect.arrayContaining(requiredOperations));
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it("keeps every approved v1 resource family in the canonical contract", () => {
    expect(Object.keys(document.paths ?? {})).toEqual(
      expect.arrayContaining(requiredPaths),
    );
  });

  it("rejects unknown fields on JSON mutations", () => {
    for (const schemaName of mutationSchemas) {
      expect(
        document.components?.schemas?.[schemaName]?.additionalProperties,
        schemaName,
      ).toBe(false);
    }
  });

  it("keeps outbound webhook delivery outside local v1", () => {
    expect(document.paths?.["/webhooks"]?.get?.operationId).toBe(
      "listWebhooks",
    );
    expect(document.paths?.["/webhooks"]?.post).toBeUndefined();
  });

  it("requires stable problem details and request correlation", () => {
    expect(document.components?.schemas?.Problem?.required).toEqual(
      expect.arrayContaining([
        "type",
        "title",
        "status",
        "detail",
        "instance",
        "code",
        "request_id",
      ]),
    );
  });
});
