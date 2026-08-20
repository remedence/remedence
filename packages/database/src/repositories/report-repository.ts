import type { Report, ReportRepository } from "@remedence/core";
import { getDatabaseConnection, type RemedenceDatabase } from "../database.js";
import { mapReportRow } from "../rows.js";

const REPORT_COLUMNS = `
  r.id,
  r.company_id,
  r.title,
  r.period_label,
  r.status,
  r.snapshot_json,
  r.generated_at,
  r.created_at
`;

export function createReportRepository(
  database: RemedenceDatabase,
): ReportRepository {
  const connection = getDatabaseConnection(database);
  const getByIdStatement = connection.prepare(
    `SELECT ${REPORT_COLUMNS}
     FROM reports AS r
     JOIN companies AS c ON c.id = r.company_id
     WHERE c.organization_id = ? AND r.id = ?`,
  );
  const listByCompanyStatement = connection.prepare(
    `SELECT ${REPORT_COLUMNS}
     FROM reports AS r
     JOIN companies AS c ON c.id = r.company_id
     WHERE c.organization_id = ? AND r.company_id = ?
     ORDER BY r.generated_at DESC, r.id DESC`,
  );
  const insertStatement = connection.prepare(
    `INSERT INTO reports (
       id, company_id, title, period_label, status, snapshot_json,
       generated_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  return {
    getById(organizationId: string, reportId: string): Report | undefined {
      const row = getByIdStatement.get(organizationId, reportId);
      return row ? mapReportRow(row) : undefined;
    },

    listByCompany(organizationId: string, companyId: string): Report[] {
      return listByCompanyStatement
        .all(organizationId, companyId)
        .map(mapReportRow);
    },

    insert(report: Report): void {
      insertStatement.run(
        report.id,
        report.companyId,
        report.title,
        report.periodLabel,
        report.status,
        JSON.stringify(report.snapshot),
        report.generatedAt,
        report.createdAt,
      );
    },
  };
}
