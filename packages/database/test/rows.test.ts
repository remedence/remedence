import { describe, expect, it } from "vitest";
import {
  mapAuditEventRow,
  mapCompanyRow,
  mapDashboardFindingRow,
  mapEvidenceItemRow,
  mapFindingRow,
  mapOrganizationRow,
  mapRemediationRow,
  mapVerificationCheckRow,
  mapVerificationRunRow,
} from "../src/rows.js";

const findingRow = {
  id: "finding-sec-1042",
  organization_id: "org-harborline",
  company_id: "company-juniper",
  finding_key: "SEC-1042",
  title: "Critical SQL injection",
  description: "A query path remains vulnerable.",
  source: "Manual",
  severity: "Critical",
  state: "Verification failed",
  owner: "L. Chen",
  asset_name: "Patient Portal API",
  detected_at: "2026-08-10T12:00:00.000Z",
  sla_due_at: "2026-08-11T12:00:00.000Z",
  created_at: "2026-08-10T12:00:00.000Z",
  updated_at: "2026-08-12T12:00:00.000Z",
};

describe("database row mappings", () => {
  it("maps organization snake_case columns without mutating the source row", () => {
    const row = {
      id: "org-harborline",
      name: "Harborline Technology Group",
      created_at: "2026-08-01T00:00:00.000Z",
    };
    const original = structuredClone(row);

    expect(mapOrganizationRow(row)).toEqual({
      id: "org-harborline",
      name: "Harborline Technology Group",
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    expect(row).toEqual(original);
  });

  it("maps company snake_case columns to the core domain object", () => {
    expect(
      mapCompanyRow({
        id: "company-juniper",
        organization_id: "org-harborline",
        name: "Juniper Ridge Dental",
        risk_score: 82,
        risk_level: "Critical",
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-02T00:00:00.000Z",
      }),
    ).toEqual({
      id: "company-juniper",
      organizationId: "org-harborline",
      name: "Juniper Ridge Dental",
      riskScore: 82,
      riskLevel: "Critical",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    });
  });

  it("maps finding snake_case columns to the core domain object", () => {
    expect(mapFindingRow(findingRow)).toMatchObject({
      id: "finding-sec-1042",
      organizationId: "org-harborline",
      companyId: "company-juniper",
      findingKey: "SEC-1042",
      assetName: "Patient Portal API",
      detectedAt: "2026-08-10T12:00:00.000Z",
      slaDueAt: "2026-08-11T12:00:00.000Z",
      updatedAt: "2026-08-12T12:00:00.000Z",
    });
  });

  it("throws when a required finding column is absent", () => {
    const { owner: _owner, ...missingOwner } = findingRow;
    expect(() => mapFindingRow(missingOwner)).toThrow(/owner/);
  });

  it("maps dashboard integer booleans and rejects unexpected numeric values", () => {
    expect(
      mapDashboardFindingRow({
        ...findingRow,
        company_name: "Juniper Ridge Dental",
        sla_breached: 1,
        priority_bucket: 1,
      }),
    ).toMatchObject({
      companyName: "Juniper Ridge Dental",
      slaBreached: true,
      priorityBucket: 1,
    });

    expect(() =>
      mapDashboardFindingRow({
        ...findingRow,
        company_name: "Juniper Ridge Dental",
        sla_breached: 2,
        priority_bucket: 1,
      }),
    ).toThrow(/sla_breached/);
  });

  it("parses audit details intentionally", () => {
    expect(
      mapAuditEventRow({
        id: 7,
        organization_id: "org-harborline",
        actor_type: "operator",
        actor_id: "local-user",
        action: "verification.failed",
        entity_type: "finding",
        entity_id: "finding-sec-1042",
        details_json: '{"reason":"secondary path remains vulnerable"}',
        occurred_at: "2026-08-12T12:00:00.000Z",
      }),
    ).toEqual({
      id: 7,
      organizationId: "org-harborline",
      actorType: "operator",
      actorId: "local-user",
      action: "verification.failed",
      entityType: "finding",
      entityId: "finding-sec-1042",
      details: { reason: "secondary path remains vulnerable" },
      occurredAt: "2026-08-12T12:00:00.000Z",
    });
  });

  it("throws instead of replacing malformed required JSON", () => {
    expect(() =>
      mapAuditEventRow({
        id: 8,
        organization_id: "org-harborline",
        actor_type: "operator",
        actor_id: "local-user",
        action: "verification.failed",
        entity_type: "finding",
        entity_id: "finding-sec-1042",
        details_json: "{not-json",
        occurred_at: "2026-08-12T12:00:00.000Z",
      }),
    ).toThrow(/details_json/);
  });

  it("maps remediation, verification, and check rows needed by finding detail", () => {
    expect(
      mapRemediationRow({
        id: "remediation-1",
        finding_id: "finding-sec-1042",
        status: "Completed",
        summary: "Patched primary query path",
        reference: "CHG-1042-1",
        owner: "L. Chen",
        started_at: "2026-08-11T00:00:00.000Z",
        completed_at: "2026-08-11T06:00:00.000Z",
        created_at: "2026-08-11T00:00:00.000Z",
        updated_at: "2026-08-11T06:00:00.000Z",
      }),
    ).toMatchObject({ findingId: "finding-sec-1042", status: "Completed" });

    expect(
      mapVerificationRunRow({
        id: "verification-1",
        finding_id: "finding-sec-1042",
        remediation_id: "remediation-1",
        status: "Failed",
        method: "Independent manual retest",
        worker_name: "Operator",
        scope: "Patient Portal API",
        result_summary: "Secondary query path remains vulnerable",
        started_at: "2026-08-12T00:00:00.000Z",
        completed_at: "2026-08-12T00:10:00.000Z",
        created_at: "2026-08-12T00:00:00.000Z",
      }),
    ).toMatchObject({ remediationId: "remediation-1", status: "Failed" });

    expect(
      mapVerificationCheckRow({
        id: "check-1",
        verification_id: "verification-1",
        sequence: 1,
        name: "Primary query path",
        status: "Passed",
        message: "No injection reproduced",
        created_at: "2026-08-12T00:05:00.000Z",
      }),
    ).toMatchObject({ verificationId: "verification-1", sequence: 1 });
  });

  it("parses evidence metadata JSON for later detail reads", () => {
    expect(
      mapEvidenceItemRow({
        id: "evidence-1",
        finding_id: "finding-verified",
        verification_id: "verification-passed",
        kind: "verification-result",
        label: "Independent retest",
        source_reference: "verification://passed",
        content_hash: "a".repeat(64),
        metadata_json: '{"check_count":3}',
        created_at: "2026-08-10T00:00:00.000Z",
        locked_at: "2026-08-10T00:00:01.000Z",
      }),
    ).toMatchObject({
      sourceReference: "verification://passed",
      metadata: { check_count: 3 },
      lockedAt: "2026-08-10T00:00:01.000Z",
    });
  });
});
