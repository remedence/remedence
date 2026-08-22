import type { Company, CompanyRepository } from "@remedence/core";
import { getDatabaseConnection, type RemedenceDatabase } from "../database.js";
import { mapCompanyRow } from "../rows.js";

const COMPANY_COLUMNS = `
  id,
  organization_id,
  name,
  risk_score,
  risk_level,
  created_at,
  updated_at
`;

export function createCompanyRepository(
  database: RemedenceDatabase,
): CompanyRepository {
  const connection = getDatabaseConnection(database);
  const getByIdStatement = connection.prepare(
    `SELECT ${COMPANY_COLUMNS}
     FROM companies
     WHERE organization_id = ? AND id = ?`,
  );
  const listStatement = connection.prepare(
    `SELECT ${COMPANY_COLUMNS}
     FROM companies
     WHERE organization_id = ?
     ORDER BY name COLLATE NOCASE ASC, id ASC`,
  );
  const insertStatement = connection.prepare(
    `INSERT INTO companies (
       id, organization_id, name, risk_score, risk_level, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  return {
    getById(organizationId: string, companyId: string): Company | undefined {
      const row = getByIdStatement.get(organizationId, companyId);
      return row ? mapCompanyRow(row) : undefined;
    },

    list(organizationId: string): Company[] {
      return listStatement.all(organizationId).map(mapCompanyRow);
    },

    insert(company: Company): void {
      insertStatement.run(
        company.id,
        company.organizationId,
        company.name,
        company.riskScore,
        company.riskLevel,
        company.createdAt,
        company.updatedAt,
      );
    },
  };
}
