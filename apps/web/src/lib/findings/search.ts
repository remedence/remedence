import type { Finding } from "../../data";

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

export function normalizeFindingKey(value: string): string {
  return value.trim().toLocaleUpperCase("en-US");
}

export function searchWorkspace(
  query: string,
  findings: Finding[],
  companies: CompanyRiskRow[],
): WorkspaceSearchResult[] {
  const normalized = query.trim().toLocaleLowerCase("en-US");
  if (!normalized) return [];

  const findingResults: WorkspaceSearchResult[] = findings
    .filter((finding) =>
      [
        finding.id,
        finding.title,
        finding.company,
        finding.source,
        finding.owner,
      ]
        .join(" ")
        .toLocaleLowerCase("en-US")
        .includes(normalized),
    )
    .map((finding) => ({
      kind: "finding",
      id: finding.id,
      primary: `${finding.id} · ${finding.title}`,
      secondary: `${finding.company} · ${finding.state} · ${finding.source} · ${finding.owner}`,
    }));

  const companyResults: WorkspaceSearchResult[] = companies
    .filter((company) =>
      company.company.toLocaleLowerCase("en-US").includes(normalized),
    )
    .map((company) => ({
      kind: "company",
      id: company.company,
      primary: company.company,
      secondary: `Risk ${company.risk} · ${company.band} · ${company.open} open`,
    }));

  return [...findingResults, ...companyResults];
}
