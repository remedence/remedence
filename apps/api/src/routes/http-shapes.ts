import type {
  AuditEvent,
  Company,
  DashboardFinding,
  DashboardSnapshot,
  EvidenceItem,
  Finding,
  FindingDetail,
  ImportResult,
  CursorPage,
  Remediation,
  Report,
  VerificationCheck,
  VerificationCompletion,
  VerificationRun,
} from "@remedence/core";

export function toCompany(company: Company) {
  return {
    id: company.id,
    organization_id: company.organizationId,
    name: company.name,
    risk_score: company.riskScore,
    risk_level: company.riskLevel,
    created_at: company.createdAt,
    updated_at: company.updatedAt,
  };
}

export function toFinding(finding: Finding) {
  return {
    id: finding.id,
    organization_id: finding.organizationId,
    company_id: finding.companyId,
    finding_key: finding.findingKey,
    title: finding.title,
    description: finding.description,
    source: finding.source,
    severity: finding.severity,
    state: finding.state,
    owner: finding.owner,
    asset_name: finding.assetName,
    detected_at: finding.detectedAt,
    sla_due_at: finding.slaDueAt,
    created_at: finding.createdAt,
    updated_at: finding.updatedAt,
  };
}

function toDashboardFinding(finding: DashboardFinding) {
  return {
    ...toFinding(finding),
    company_name: finding.companyName,
    sla_breached: finding.slaBreached,
    priority_bucket: finding.priorityBucket,
  };
}

export function toRemediation(remediation: Remediation) {
  return {
    id: remediation.id,
    finding_id: remediation.findingId,
    status: remediation.status,
    summary: remediation.summary,
    reference: remediation.reference,
    owner: remediation.owner,
    started_at: remediation.startedAt,
    completed_at: remediation.completedAt,
    created_at: remediation.createdAt,
    updated_at: remediation.updatedAt,
  };
}

export function toVerificationRun(verification: VerificationRun) {
  return {
    id: verification.id,
    finding_id: verification.findingId,
    remediation_id: verification.remediationId,
    status: verification.status,
    method: verification.method,
    worker_name: verification.workerName,
    credential_type: verification.credentialType,
    execution_source: verification.executionSource,
    source_revision: verification.sourceRevision,
    patch_digest: verification.patchDigest,
    scope: verification.scope,
    result_summary: verification.resultSummary,
    started_at: verification.startedAt,
    completed_at: verification.completedAt,
    created_at: verification.createdAt,
  };
}

export function toVerificationCheck(check: VerificationCheck) {
  return {
    id: check.id,
    verification_id: check.verificationId,
    sequence: check.sequence,
    name: check.name,
    status: check.status,
    message: check.message,
    created_at: check.createdAt,
  };
}

export function toVerificationWithChecks(
  verification: VerificationRun & { checks: VerificationCheck[] },
) {
  const { checks, ...run } = verification;
  return {
    verification: toVerificationRun(run),
    checks: checks.map(toVerificationCheck),
  };
}

export function toEvidence(item: EvidenceItem) {
  return {
    id: item.id,
    finding_id: item.findingId,
    verification_id: item.verificationId,
    kind: item.kind,
    label: item.label,
    source_reference: item.sourceReference,
    content_hash: item.contentHash,
    artifact_id: item.artifactId,
    manifest_hash: item.manifestHash,
    manifest_signature: item.manifestSignature,
    attested_by: item.attestedBy,
    metadata: item.metadata,
    created_at: item.createdAt,
    locked_at: item.lockedAt,
  };
}

export function toAuditEvent(event: AuditEvent) {
  if (event.id === undefined) {
    throw new Error("Persisted audit event is missing its identifier.");
  }
  return {
    id: event.id,
    organization_id: event.organizationId,
    actor_type: event.actorType,
    actor_id: event.actorId,
    action: event.action,
    entity_type: event.entityType,
    entity_id: event.entityId,
    details: event.details,
    occurred_at: event.occurredAt,
  };
}

export function toReport(report: Report) {
  return {
    id: report.id,
    company_id: report.companyId,
    title: report.title,
    period_label: report.periodLabel,
    status: report.status,
    snapshot: {
      company_name: report.snapshot.companyName,
      risk_score: report.snapshot.riskScore,
      critical_findings: report.snapshot.criticalFindings,
      high_findings: report.snapshot.highFindings,
      verified_fixes: report.snapshot.verifiedFixes,
      sla_compliance_percent: report.snapshot.slaCompliancePercent,
      findings: report.snapshot.findings.map(toFinding),
      verification_history: report.snapshot.verificationHistory.map(
        toVerificationWithChecks,
      ),
    },
    generated_at: report.generatedAt,
    created_at: report.createdAt,
  };
}

export function toFindingPage(page: CursorPage<DashboardFinding>) {
  return {
    items: page.items.map(toDashboardFinding),
    page_size: page.pageSize,
    total: page.total,
    next_cursor: page.nextCursor,
  };
}

export function toAuditEventPage(page: CursorPage<AuditEvent>) {
  return {
    items: page.items.map(toAuditEvent),
    page_size: page.pageSize,
    total: page.total,
    next_cursor: page.nextCursor,
  };
}

export function toFindingDetail(detail: FindingDetail) {
  return {
    finding: toFinding(detail.finding),
    company: toCompany(detail.company),
    remediations: detail.remediations.map(toRemediation),
    verifications: detail.verifications.map(toVerificationWithChecks),
    evidence: detail.evidence.map(toEvidence),
    audit_events: detail.auditEvents.map(toAuditEvent),
  };
}

export function toImportResult(result: ImportResult) {
  return {
    import_record: {
      id: result.importRecord.id,
      source: result.importRecord.source,
      finding_id: result.importRecord.findingId,
      created_at: result.importRecord.createdAt,
    },
    finding: toFinding(result.finding),
  };
}

export function toVerificationCompletion(completion: VerificationCompletion) {
  return {
    verification: toVerificationRun(completion.verification),
    finding: toFinding(completion.finding),
    evidence: completion.evidence.map(toEvidence),
  };
}

export function toDashboard(snapshot: DashboardSnapshot) {
  return {
    metrics: {
      managed_companies: snapshot.metrics.managedCompanies,
      open_findings: snapshot.metrics.openFindings,
      awaiting_verification: snapshot.metrics.awaitingVerification,
      verification_failed: snapshot.metrics.verificationFailed,
      verified_fixed: snapshot.metrics.verifiedFixed,
      sla_breaches: snapshot.metrics.slaBreaches,
    },
    action_queue: snapshot.actionQueue.map(toDashboardFinding),
    companies: snapshot.companies.map((company) => ({
      company_id: company.companyId,
      company_name: company.companyName,
      risk_score: company.riskScore,
      risk_level: company.riskLevel,
      open_findings: company.openFindings,
      awaiting_verification: company.awaitingVerification,
      verification_failed: company.verificationFailed,
    })),
    verification_activity: snapshot.verificationActivity.map((activity) => ({
      verification_id: activity.verificationId,
      finding_key: activity.findingKey,
      company_name: activity.companyName,
      status: activity.status,
      result_summary: activity.resultSummary,
      completed_at: activity.completedAt,
    })),
    notifications: snapshot.notifications.map((notification) => ({
      id: notification.id,
      status: notification.status,
      message: notification.message,
    })),
    latest_report: snapshot.latestReport
      ? toReport(snapshot.latestReport)
      : null,
  };
}
