import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

interface OpenApiOperation {
  operationId?: string;
  parameters?: Array<{ $ref?: string }>;
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
  "initializeWorkspace",
  "listFindings",
  "getFinding",
  "createImport",
  "createRemediation",
  "completeRemediation",
  "createVerification",
  "listVerificationProfiles",
  "getVerificationJob",
  "cancelVerificationJob",
  "retryVerificationJob",
  "createVerificationCheck",
  "completeVerification",
  "listEvidence",
  "uploadEvidenceArtifact",
  "getEvidence",
  "createReport",
  "getReport",
  "downloadReport",
  "listAuditEvents",
  "listIntegrations",
  "createIntegration",
  "disableIntegration",
  "listIntegrationDeliveries",
  "enqueueIntegrationDelivery",
  "retryIntegrationDelivery",
  "exportTenantData",
  "setEvidenceLegalHold",
  "deleteTenant",
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
  "/privacy/export",
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
  "CreateIntegrationRequest",
  "CreateIntegrationDeliveryRequest",
  "SetLegalHoldRequest",
  "DeleteTenantRequest",
] as const;

const mutationPaths = [
  "/onboarding",
  "/imports",
  "/remediations",
  "/remediations/{remediationId}/complete",
  "/verifications",
  "/verifications/{verificationId}/checks",
  "/verifications/{verificationId}/complete",
  "/verification-jobs/{jobId}/cancel",
  "/verification-jobs/{jobId}/retry",
  "/evidence/artifacts",
  "/reports",
  "/integrations",
  "/integrations/{connectionId}/disable",
  "/integrations/{connectionId}/deliveries",
  "/integration-deliveries/{deliveryId}/retry",
  "/privacy/artifacts/{artifactId}/legal-hold",
  "/privacy/delete-tenant",
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

  it("offers durable replay protection on every mutation", () => {
    for (const path of mutationPaths) {
      const pathItem = document.paths?.[path];
      const parameters = [
        ...(pathItem?.parameters ?? []),
        ...(pathItem?.post?.parameters ?? []),
      ];
      expect(
        parameters.map((parameter) => parameter.$ref),
        path,
      ).toContain("#/components/parameters/IdempotencyKey");
    }
  });

  it("exposes inbound webhook registrations without a secret mutation route", () => {
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
