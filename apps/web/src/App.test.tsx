import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./app/App";
import type { components } from "./lib/api/schema";
import { dashboardFindingFixture, dashboardFixture } from "./test/fixtures";

function jsonResponse(
  body: unknown,
  status = 200,
  contentType = "application/json",
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": contentType,
      "X-Request-ID": "req-web-test",
    },
  });
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input), window.location.origin);
}

describe("Remedence API-backed read models", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
  });

  it("renders dashboard metrics and queue data returned by the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(dashboardFixture)),
    );

    render(<App />);

    expect(
      await screen.findByRole("button", { name: /Managed companies 21/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Open findings 34/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("SEC-2099").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("API-backed patient export regression").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("SEC-1042")).not.toBeInTheDocument();
  });

  it("renders API-backed company risk, verification activity, notifications, and latest report", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(jsonResponse(dashboardFixture)),
        ),
    );
    const user = userEvent.setup();

    render(<App />);

    expect(
      (await screen.findAllByText("Juniper Ridge Dental")).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText("Secondary path still accepted the regression payload."),
    ).toBeInTheDocument();
    expect(screen.getByText(/August Security Review/)).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Notifications, 1 unread/i }),
    );
    expect(
      screen.getByText("2 findings have failed verification."),
    ).toBeInTheDocument();
  });

  it("keeps historical verified findings out of the default action queue request", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(dashboardFixture)),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = requestUrl(fetchMock.mock.calls[0]![0] as RequestInfo | URL);
    expect(url.searchParams.get("include_verified")).toBe("false");
  });

  it("requests verified history only when the verified state is selected", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(dashboardFixture)),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });
    await user.selectOptions(
      screen.getAllByLabelText("State")[0]!,
      "Verified fixed",
    );

    await waitFor(() => {
      const url = requestUrl(
        fetchMock.mock.calls.at(-1)![0] as RequestInfo | URL,
      );
      expect(url.searchParams.get("state")).toBe("Verified fixed");
      expect(url.searchParams.get("include_verified")).toBe("true");
    });
  });

  it("does not duplicate the company name in an API report title", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          jsonResponse({
            ...dashboardFixture,
            latest_report: {
              ...dashboardFixture.latest_report!,
              title: "Juniper Ridge Dental — August Security Review",
            },
          }),
        ),
      ),
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Juniper Ridge Dental — August Security Review",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        level: 2,
        name: /Juniper Ridge Dental · Juniper Ridge Dental/,
      }),
    ).not.toBeInTheDocument();
  });

  it("shows a written loading state while the API request is pending", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    render(<App />);

    expect(
      screen.getByText("Loading remediation workspace."),
    ).toBeInTheDocument();
  });

  it("renders application/problem+json details, request ID, and Retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            type: "https://remedence.dev/problems/read-failed",
            title: "Workspace read failed",
            status: 500,
            detail: "The local remediation read model could not be loaded.",
            instance: "/api/v1/dashboard",
            code: "READ_FAILED",
            request_id: "req-problem-14",
          },
          500,
          "application/problem+json",
        ),
      ),
    );

    render(<App />);

    expect(
      await screen.findByText("Workspace read failed"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The local remediation read model could not be loaded."),
    ).toBeInTheDocument();
    expect(screen.getByText(/req-problem-14/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("sanitizes non-API network failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new Error(
            "C:\\private\\workspace\\secret-token.txt failed to connect",
          ),
        ),
    );

    render(<App />);

    expect(
      await screen.findByText("Unable to reach local API"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Remedence could not reach the local API. Check the local service and try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/secret-token/)).not.toBeInTheDocument();
  });

  it("shows an API-backed empty queue with Clear filters", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ ...dashboardFixture, action_queue: [] }),
        ),
    );

    render(<App />);

    expect(
      await screen.findByText("No findings match these filters."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear filters" }),
    ).toBeInTheDocument();
  });

  it("initializes canonical API filters from the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(dashboardFixture));
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(
      {},
      "",
      "/?search=api&owner=A.%20Rivera&severity=Critical&state=Verification%20failed&company_id=company-juniper&sort=newest",
    );

    render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = requestUrl(fetchMock.mock.calls[0]![0] as RequestInfo | URL);
    expect(url.pathname).toBe("/api/v1/dashboard");
    expect(url.searchParams.get("search")).toBe("api");
    expect(url.searchParams.get("owner")).toBe("A. Rivera");
    expect(url.searchParams.get("severity")).toBe("Critical");
    expect(url.searchParams.get("state")).toBe("Verification failed");
    expect(url.searchParams.get("company_id")).toBe("company-juniper");
    expect(url.searchParams.get("sort")).toBe("newest");
  });

  it("refreshes the API request when search changes", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(dashboardFixture)),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });

    const search = screen.getByLabelText("Search findings");
    await user.type(search, "patient");

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          requestUrl(input as RequestInfo | URL)
            .searchParams.get("search")
            ?.includes("patient"),
        ),
      ).toBe(true);
    });
  });

  it("sends all finding filters to the API and persists them in the URL", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(dashboardFixture)),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });

    await user.selectOptions(
      screen.getAllByLabelText("Company")[0]!,
      "company-juniper",
    );
    await user.selectOptions(
      screen.getAllByLabelText("State")[0]!,
      "Verification failed",
    );
    await user.selectOptions(
      screen.getAllByLabelText("Severity")[0]!,
      "Critical",
    );
    await user.selectOptions(
      screen.getAllByLabelText("Owner")[0]!,
      "A. Rivera",
    );
    await user.selectOptions(screen.getAllByLabelText("Sort")[0]!, "newest");

    await waitFor(() => {
      const url = requestUrl(
        fetchMock.mock.calls.at(-1)![0] as RequestInfo | URL,
      );
      expect(url.searchParams.get("company_id")).toBe("company-juniper");
      expect(url.searchParams.get("state")).toBe("Verification failed");
      expect(url.searchParams.get("severity")).toBe("Critical");
      expect(url.searchParams.get("owner")).toBe("A. Rivera");
      expect(url.searchParams.get("sort")).toBe("newest");
    });

    const browserParameters = new URLSearchParams(window.location.search);
    expect(browserParameters.get("company_id")).toBe("company-juniper");
    expect(browserParameters.get("state")).toBe("Verification failed");
    expect(browserParameters.get("severity")).toBe("Critical");
    expect(browserParameters.get("owner")).toBe("A. Rivera");
    expect(browserParameters.get("sort")).toBe("newest");
  });

  it("Clear filters resets the URL and requests the unfiltered queue", async () => {
    window.history.replaceState({}, "", "/?severity=Critical");
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      return Promise.resolve(
        jsonResponse(
          url.searchParams.has("severity")
            ? { ...dashboardFixture, action_queue: [] }
            : dashboardFixture,
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Clear filters" }),
    );

    expect(
      (await screen.findAllByText("API-backed patient export regression"))
        .length,
    ).toBeGreaterThan(0);
    expect(window.location.search).toBe("");
    const latestUrl = requestUrl(
      fetchMock.mock.calls.at(-1)![0] as RequestInfo | URL,
    );
    expect(latestUrl.searchParams.has("severity")).toBe(false);
  });

  it("restores filters from popstate and refreshes the API request", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(dashboardFixture)),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Dashboard" });

    act(() => {
      window.history.replaceState(
        {},
        "",
        "/?severity=Critical&state=Verification%20failed&sort=newest",
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await waitFor(() => {
      expect(screen.getAllByLabelText("Severity")[0]).toHaveValue("Critical");
      expect(screen.getAllByLabelText("State")[0]).toHaveValue(
        "Verification failed",
      );
      expect(screen.getAllByLabelText("Sort")[0]).toHaveValue("newest");
      const url = requestUrl(
        fetchMock.mock.calls.at(-1)![0] as RequestInfo | URL,
      );
      expect(url.searchParams.get("severity")).toBe("Critical");
      expect(url.searchParams.get("state")).toBe("Verification failed");
      expect(url.searchParams.get("sort")).toBe("newest");
    });
  });

  it("degrades invalid URL enum values to safe API defaults", async () => {
    window.history.replaceState(
      {},
      "",
      "/?severity=Impossible&state=Unknown&sort=wrong",
    );
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(dashboardFixture));
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = requestUrl(fetchMock.mock.calls[0]![0] as RequestInfo | URL);
    expect(url.searchParams.has("severity")).toBe(false);
    expect(url.searchParams.has("state")).toBe(false);
    expect(url.searchParams.get("sort")).toBe("priority");
  });

  it("Retry performs a real new request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            type: "about:blank",
            title: "Temporary read failure",
            status: 500,
            detail: "Try the local API again.",
            instance: "/api/v1/dashboard",
            code: "TEMPORARY_FAILURE",
            request_id: "req-retry-1",
          },
          500,
          "application/problem+json",
        ),
      )
      .mockResolvedValueOnce(jsonResponse(dashboardFixture));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Retry" }));

    expect(
      await screen.findByRole("button", { name: /Managed companies 21/i }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts stale requests and ignores an older response", async () => {
    let resolveFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstResponse)
      .mockResolvedValue(jsonResponse(dashboardFixture));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<App />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText("Global search"), "x");
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));

    const firstRequest = fetchMock.mock.calls[0]![0] as Request;
    expect(firstRequest.signal.aborted).toBe(true);

    resolveFirst(
      jsonResponse({
        ...dashboardFixture,
        metrics: { ...dashboardFixture.metrics, managed_companies: 777 },
      }),
    );

    expect(
      await screen.findByRole("button", { name: /Managed companies 21/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Managed companies 777/i }),
    ).not.toBeInTheDocument();
  });

  describe("persistent mutation workflows", () => {
    it("imports a normalized finding through the typed API and reloads persisted dashboard truth", async () => {
      const importedFinding = {
        ...dashboardFixture.action_queue[0]!,
        id: "finding-imported-3001",
        finding_key: "SEC-3001",
        title: "Imported API finding",
        description: "Imported from the mutation workflow.",
        source: "Semgrep",
        state: "Needs remediation" as const,
        sla_breached: false,
        priority_bucket: 4,
      };
      let dashboardReads = 0;
      let importBody: unknown;
      const fetchMock = vi
        .fn()
        .mockImplementation(
          async (input: RequestInfo | URL, init?: RequestInit) => {
            const request =
              input instanceof Request
                ? input
                : new Request(String(input), init);
            const url = new URL(request.url);
            if (
              request.method === "POST" &&
              url.pathname === "/api/v1/imports"
            ) {
              importBody = await request.json();
              return jsonResponse(
                {
                  import_record: {
                    id: "import-3001",
                    source: "Semgrep",
                    finding_id: importedFinding.id,
                    created_at: "2026-08-21T04:00:00.000Z",
                  },
                  finding: importedFinding,
                },
                201,
              );
            }
            dashboardReads += 1;
            return jsonResponse(
              dashboardReads === 1
                ? dashboardFixture
                : {
                    ...dashboardFixture,
                    metrics: {
                      ...dashboardFixture.metrics,
                      open_findings: dashboardFixture.metrics.open_findings + 1,
                    },
                    action_queue: [
                      importedFinding,
                      ...dashboardFixture.action_queue,
                    ],
                  },
            );
          },
        );
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();

      render(<App />);
      await user.click(
        await screen.findByRole("button", { name: "Import finding" }),
      );
      const dialog = within(
        screen.getByRole("dialog", { name: "Import finding" }),
      );
      await user.selectOptions(
        dialog.getByLabelText("Company"),
        "company-juniper",
      );
      await user.type(dialog.getByLabelText("Source"), "  Semgrep  ");
      await user.type(dialog.getByLabelText("Finding key"), " sec-3001 ");
      await user.type(dialog.getByLabelText("Title"), " Imported API finding ");
      await user.type(
        dialog.getByLabelText("Description"),
        " Imported from the mutation workflow. ",
      );
      await user.selectOptions(dialog.getByLabelText("Severity"), "High");
      await user.type(dialog.getByLabelText("Owner"), " A. Rivera ");
      await user.type(dialog.getByLabelText("Asset"), " patient-export-api ");
      await user.type(dialog.getByLabelText("Detected at"), "2026-08-20T20:00");
      await user.type(dialog.getByLabelText("SLA due at"), "2026-08-21T20:00");
      await user.click(dialog.getByRole("button", { name: "Import finding" }));

      expect((await screen.findAllByText("SEC-3001")).length).toBeGreaterThan(
        0,
      );
      expect(importBody).toMatchObject({
        company_id: "company-juniper",
        source: "Semgrep",
        finding_key: "SEC-3001",
        title: "Imported API finding",
        description: "Imported from the mutation workflow.",
        severity: "High",
        owner: "A. Rivera",
        asset_name: "patient-export-api",
      });
      expect(dashboardReads).toBe(2);
      expect(
        screen.queryByRole("dialog", { name: "Import finding" }),
      ).not.toBeInTheDocument();
    });

    it("keeps import values and renders the API problem when a duplicate returns 409", async () => {
      const duplicateProblem = {
        type: "about:blank",
        title: "Duplicate finding",
        status: 409,
        detail: "SEC-1042 already exists for this organization.",
        instance: "/api/v1/imports",
        code: "DUPLICATE_FINDING",
        request_id: "req-import-409",
      };
      let dashboardReads = 0;
      const fetchMock = vi
        .fn()
        .mockImplementation(
          async (input: RequestInfo | URL, init?: RequestInit) => {
            const request =
              input instanceof Request
                ? input
                : new Request(String(input), init);
            const url = new URL(request.url);
            if (
              request.method === "POST" &&
              url.pathname === "/api/v1/imports"
            ) {
              return jsonResponse(
                duplicateProblem,
                409,
                "application/problem+json",
              );
            }
            dashboardReads += 1;
            return jsonResponse(dashboardFixture);
          },
        );
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();

      render(<App />);
      await user.click(
        await screen.findByRole("button", { name: "Import finding" }),
      );
      const dialog = within(
        screen.getByRole("dialog", { name: "Import finding" }),
      );
      await user.selectOptions(
        dialog.getByLabelText("Company"),
        "company-juniper",
      );
      await user.type(dialog.getByLabelText("Source"), "Semgrep");
      await user.type(dialog.getByLabelText("Finding key"), "SEC-1042");
      await user.type(dialog.getByLabelText("Title"), "Duplicate title");
      await user.type(
        dialog.getByLabelText("Description"),
        "Duplicate description",
      );
      await user.selectOptions(dialog.getByLabelText("Severity"), "Critical");
      await user.type(dialog.getByLabelText("Owner"), "A. Rivera");
      await user.type(dialog.getByLabelText("Asset"), "patient-export-api");
      await user.type(dialog.getByLabelText("Detected at"), "2026-08-20T20:00");
      await user.type(dialog.getByLabelText("SLA due at"), "2026-08-21T20:00");
      await user.click(dialog.getByRole("button", { name: "Import finding" }));

      expect(await dialog.findByText("Duplicate finding")).toBeInTheDocument();
      expect(
        dialog.getByText("SEC-1042 already exists for this organization."),
      ).toBeInTheDocument();
      expect(dialog.getByText(/Request ID:/)).toBeInTheDocument();
      expect(dialog.getByText("req-import-409")).toBeInTheDocument();
      expect(dialog.getByLabelText("Finding key")).toHaveValue("SEC-1042");
      expect(dialog.getByLabelText("Title")).toHaveValue("Duplicate title");
      expect(
        screen.getByRole("dialog", { name: "Import finding" }),
      ).toBeInTheDocument();
      expect(dashboardReads).toBe(1);
    });

    it("starts and completes remediation through separate persisted API actions", async () => {
      const finding = {
        ...dashboardFindingFixture,
        id: "finding-remediation-4001",
        finding_key: "SEC-4001",
        title: "Remediation workflow finding",
        state: "Needs remediation" as const,
      };
      let state:
        typeof finding.state | "Remediating" | "Awaiting verification" =
        "Needs remediation";
      let remediation: components["schemas"]["Remediation"] | undefined;
      let startBody: unknown;
      let completeBody: unknown;
      const dashboardForState = () => ({
        ...dashboardFixture,
        action_queue: [{ ...finding, state }],
      });
      const detailForState = () => ({
        finding: { ...finding, state },
        company: {
          id: "company-juniper",
          organization_id: "org-harborline",
          name: "Juniper Ridge Dental",
          risk_score: 67,
          risk_level: "High" as const,
          created_at: "2026-08-20T18:00:00.000Z",
          updated_at: "2026-08-20T18:00:00.000Z",
        },
        remediations: remediation ? [remediation] : [],
        verifications: [],
        evidence: [],
        audit_events: [],
      });
      const fetchMock = vi
        .fn()
        .mockImplementation(
          async (input: RequestInfo | URL, init?: RequestInit) => {
            const request =
              input instanceof Request
                ? input
                : new Request(String(input), init);
            const url = new URL(request.url);
            if (
              request.method === "GET" &&
              url.pathname === "/api/v1/dashboard"
            ) {
              return jsonResponse(dashboardForState());
            }
            if (
              request.method === "GET" &&
              url.pathname === "/api/v1/findings/SEC-4001"
            ) {
              return jsonResponse(detailForState());
            }
            if (
              request.method === "POST" &&
              url.pathname === "/api/v1/remediations"
            ) {
              startBody = await request.json();
              state = "Remediating";
              remediation = {
                id: "remediation-4001",
                finding_id: finding.id,
                status: "In progress",
                summary: "Patch the export authorization path.",
                reference: "PR-4001",
                owner: "A. Rivera",
                started_at: "2026-08-21T04:10:00.000Z",
                completed_at: null,
                created_at: "2026-08-21T04:10:00.000Z",
                updated_at: "2026-08-21T04:10:00.000Z",
              };
              return jsonResponse(remediation, 201);
            }
            if (
              request.method === "POST" &&
              url.pathname === "/api/v1/remediations/remediation-4001/complete"
            ) {
              completeBody = await request.json();
              state = "Awaiting verification";
              remediation = {
                ...remediation!,
                status: "Completed",
                summary: "Merged authorization fix.",
                reference: "commit-4001",
                completed_at: "2026-08-21T04:20:00.000Z",
                updated_at: "2026-08-21T04:20:00.000Z",
              };
              return jsonResponse(remediation);
            }
            throw new Error(
              `Unexpected request: ${request.method} ${url.pathname}`,
            );
          },
        );
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();

      render(<App />);
      const startButton = (
        await screen.findAllByRole("button", {
          name: "Start remediation",
        })
      )[0]!;
      await user.click(startButton);

      const panel = within(
        await screen.findByRole("dialog", { name: "Remediation" }),
      );
      await user.clear(panel.getByLabelText("Remediation owner"));
      await user.type(panel.getByLabelText("Remediation owner"), "A. Rivera");
      await user.type(
        panel.getByLabelText("Remediation summary"),
        "Patch the export authorization path.",
      );
      await user.type(panel.getByLabelText("Remediation reference"), "PR-4001");
      await user.click(
        panel.getByRole("button", { name: "Start remediation" }),
      );

      expect(await panel.findByText("remediation-4001")).toBeInTheDocument();
      expect(panel.getByText("PR-4001")).toBeInTheDocument();
      expect(startBody).toEqual({
        finding_id: finding.id,
        owner: "A. Rivera",
        summary: "Patch the export authorization path.",
        reference: "PR-4001",
      });
      expect(
        (await screen.findAllByText("Remediating")).length,
      ).toBeGreaterThan(0);

      await user.type(
        panel.getByLabelText("Completion summary"),
        "Merged authorization fix.",
      );
      await user.type(
        panel.getByLabelText("Completion reference"),
        "commit-4001",
      );
      await user.click(
        panel.getByRole("button", { name: "Complete remediation" }),
      );

      expect(completeBody).toEqual({
        summary: "Merged authorization fix.",
        reference: "commit-4001",
      });
      await waitFor(() => {
        const row = screen.getAllByText("SEC-4001")[0]!.closest("tr");
        expect(row).not.toBeNull();
        expect(
          within(row!).getByText("Awaiting verification"),
        ).toBeInTheDocument();
        expect(
          within(row!).queryByText("Verified fixed"),
        ).not.toBeInTheDocument();
      });
    });

    it("records a failed verification through persisted checks and keeps the failed run visible", async () => {
      const finding = {
        ...dashboardFindingFixture,
        id: "finding-verification-5001",
        finding_key: "SEC-5001",
        title: "Verification workflow finding",
        state: "Awaiting verification" as const,
      };
      const remediation: components["schemas"]["Remediation"] = {
        id: "remediation-5001",
        finding_id: finding.id,
        status: "Completed",
        summary: "Authorization fix merged.",
        reference: "commit-5001",
        owner: "A. Rivera",
        started_at: "2026-08-21T04:00:00.000Z",
        completed_at: "2026-08-21T04:05:00.000Z",
        created_at: "2026-08-21T04:00:00.000Z",
        updated_at: "2026-08-21T04:05:00.000Z",
      };
      let state: components["schemas"]["FindingState"] =
        "Awaiting verification";
      let verification: components["schemas"]["VerificationRun"] | undefined;
      let checks: components["schemas"]["VerificationCheck"][] = [];
      let createBody: unknown;
      let checkBody: unknown;
      let completeBody: unknown;
      const dashboardForState = () => ({
        ...dashboardFixture,
        action_queue: [{ ...finding, state }],
      });
      const findingEntity = () => ({
        id: finding.id,
        organization_id: finding.organization_id,
        company_id: finding.company_id,
        finding_key: finding.finding_key,
        title: finding.title,
        description: finding.description,
        source: finding.source,
        severity: finding.severity,
        state,
        owner: finding.owner,
        asset_name: finding.asset_name,
        detected_at: finding.detected_at,
        sla_due_at: finding.sla_due_at,
        created_at: finding.created_at,
        updated_at: "2026-08-21T04:30:00.000Z",
      });
      const detail = () => ({
        finding: findingEntity(),
        company: {
          id: "company-juniper",
          organization_id: "org-harborline",
          name: "Juniper Ridge Dental",
          risk_score: 67,
          risk_level: "High" as const,
          created_at: "2026-08-20T18:00:00.000Z",
          updated_at: "2026-08-20T18:00:00.000Z",
        },
        remediations: [remediation],
        verifications: verification ? [{ verification, checks }] : [],
        evidence: [],
        audit_events: [],
      });
      const fetchMock = vi
        .fn()
        .mockImplementation(
          async (input: RequestInfo | URL, init?: RequestInit) => {
            const request =
              input instanceof Request
                ? input
                : new Request(String(input), init);
            const url = new URL(request.url);
            if (
              request.method === "GET" &&
              url.pathname === "/api/v1/dashboard"
            ) {
              return jsonResponse(dashboardForState());
            }
            if (
              request.method === "GET" &&
              url.pathname === "/api/v1/findings/SEC-5001"
            ) {
              return jsonResponse(detail());
            }
            if (
              request.method === "POST" &&
              url.pathname === "/api/v1/verifications"
            ) {
              createBody = await request.json();
              verification = {
                id: "verification-5001",
                finding_id: finding.id,
                remediation_id: remediation.id,
                status: "Running",
                method: "Regression test",
                worker_name: "Independent reviewer",
                credential_type: "session",
                execution_source: "authenticated-api",
                source_revision: "commit-5001",
                patch_digest: "a".repeat(64),
                scope: "Authorization boundary",
                result_summary: "",
                started_at: "2026-08-21T04:30:00.000Z",
                completed_at: null,
                created_at: "2026-08-21T04:30:00.000Z",
              };
              checks = [
                {
                  id: "check-5001-1",
                  verification_id: verification.id,
                  sequence: 1,
                  name: "Authorization regression",
                  status: "Pending",
                  message: "",
                  created_at: "2026-08-21T04:30:00.000Z",
                },
              ];
              return jsonResponse({ verification, checks }, 201);
            }
            if (
              request.method === "POST" &&
              url.pathname === "/api/v1/verifications/verification-5001/checks"
            ) {
              checkBody = await request.json();
              checks = [
                {
                  ...checks[0]!,
                  status: "Failed",
                  message: "Secondary query path remains exploitable.",
                },
              ];
              return jsonResponse(checks[0], 201);
            }
            if (
              request.method === "POST" &&
              url.pathname ===
                "/api/v1/verifications/verification-5001/complete"
            ) {
              completeBody = await request.json();
              state = "Verification failed";
              verification = {
                ...verification!,
                status: "Failed",
                result_summary: "Authorization regression still fails.",
                completed_at: "2026-08-21T04:35:00.000Z",
              };
              return jsonResponse({
                verification,
                finding: findingEntity(),
                evidence: [],
              });
            }
            throw new Error(
              `Unexpected request: ${request.method} ${url.pathname}`,
            );
          },
        );
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();

      render(<App />);
      await user.click(
        (
          await screen.findAllByRole("button", { name: "Review verification" })
        )[0]!,
      );
      const drawer = within(
        await screen.findByRole("dialog", { name: "Verification" }),
      );
      await user.type(
        drawer.getByLabelText("Verification method"),
        "Regression test",
      );
      await user.type(drawer.getByLabelText("Source revision"), "commit-5001");
      await user.type(drawer.getByLabelText("Patch SHA-256"), "a".repeat(64));
      await user.type(
        drawer.getByLabelText("Verification scope"),
        "Authorization boundary",
      );
      await user.type(
        drawer.getByLabelText("Expected checks"),
        "Authorization regression",
      );
      await user.click(
        drawer.getByRole("button", { name: "Create verification" }),
      );

      await waitFor(() => {
        expect(drawer.getAllByText("verification-5001").length).toBeGreaterThan(
          0,
        );
      });
      expect(createBody).toEqual({
        finding_id: finding.id,
        remediation_id: remediation.id,
        method: "Regression test",
        scope: "Authorization boundary",
        source_revision: "commit-5001",
        patch_digest: "a".repeat(64),
        checks: ["Authorization regression"],
      });

      await user.selectOptions(
        drawer.getByLabelText("Result for Authorization regression"),
        "Failed",
      );
      await user.type(
        drawer.getByLabelText("Message for Authorization regression"),
        "Secondary query path remains exploitable.",
      );
      await user.click(
        drawer.getByRole("button", { name: "Record Authorization regression" }),
      );
      expect(checkBody).toEqual({
        sequence: 1,
        name: "Authorization regression",
        status: "Failed",
        message: "Secondary query path remains exploitable.",
      });
      await waitFor(() => {
        expect(
          drawer.getByLabelText("Verification result summary"),
        ).toBeInTheDocument();
      });

      await user.type(
        drawer.getByLabelText("Verification result summary"),
        "Authorization regression still fails.",
      );
      await user.click(
        drawer.getByRole("button", { name: "Complete failed verification" }),
      );

      expect(completeBody).toEqual({
        result: "Failed",
        summary: "Authorization regression still fails.",
        evidence: [],
      });
      expect(
        await drawer.findByText("Verification failed"),
      ).toBeInTheDocument();
      expect(
        drawer.getAllByText("Authorization regression still fails.").length,
      ).toBeGreaterThan(0);
      expect(
        drawer.getAllByText("Secondary query path remains exploitable.").length,
      ).toBeGreaterThan(0);
      expect(
        drawer.queryByRole("button", {
          name: "Record Authorization regression",
        }),
      ).not.toBeInTheDocument();
      await waitFor(() => {
        const row = screen.getAllByText("SEC-5001")[0]!.closest("tr");
        expect(row).not.toBeNull();
        expect(
          within(row!).getByText("Verification failed"),
        ).toBeInTheDocument();
      });
    });

    it("preserves failed verification history through a second remediation and verified closure", async () => {
      const finding = {
        ...dashboardFindingFixture,
        id: "finding-verification-5002",
        finding_key: "SEC-5002",
        title: "Second remediation workflow",
        state: "Verification failed" as components["schemas"]["FindingState"],
      };
      let state: components["schemas"]["FindingState"] = "Verification failed";
      let remediations: components["schemas"]["Remediation"][] = [
        {
          id: "remediation-5002-a",
          finding_id: finding.id,
          status: "Completed",
          summary: "First patch did not fully close the path.",
          reference: "commit-first",
          owner: "A. Rivera",
          started_at: "2026-08-21T03:00:00.000Z",
          completed_at: "2026-08-21T03:10:00.000Z",
          created_at: "2026-08-21T03:00:00.000Z",
          updated_at: "2026-08-21T03:10:00.000Z",
        },
      ];
      let verifications: components["schemas"]["VerificationWithChecks"][] = [
        {
          verification: {
            id: "verification-5002-a",
            finding_id: finding.id,
            remediation_id: "remediation-5002-a",
            status: "Failed",
            method: "Regression test",
            worker_name: "Independent reviewer",
            credential_type: "session",
            execution_source: "authenticated-api",
            source_revision: "commit-5002-a",
            patch_digest: "a".repeat(64),
            scope: "Authorization boundary",
            result_summary: "First patch left a secondary path open.",
            started_at: "2026-08-21T03:15:00.000Z",
            completed_at: "2026-08-21T03:20:00.000Z",
            created_at: "2026-08-21T03:15:00.000Z",
          },
          checks: [
            {
              id: "check-5002-a-1",
              verification_id: "verification-5002-a",
              sequence: 1,
              name: "Authorization regression",
              status: "Failed",
              message: "Secondary query path remains exploitable.",
              created_at: "2026-08-21T03:15:00.000Z",
            },
          ],
        },
      ];
      let evidence: components["schemas"]["EvidenceItem"][] = [];
      let passedBody: unknown;
      const dashboardForState = () => ({
        ...dashboardFixture,
        action_queue: [{ ...finding, state }],
      });
      const findingEntity = () => ({
        id: finding.id,
        organization_id: finding.organization_id,
        company_id: finding.company_id,
        finding_key: finding.finding_key,
        title: finding.title,
        description: finding.description,
        source: finding.source,
        severity: finding.severity,
        state,
        owner: finding.owner,
        asset_name: finding.asset_name,
        detected_at: finding.detected_at,
        sla_due_at: finding.sla_due_at,
        created_at: finding.created_at,
        updated_at: "2026-08-21T05:00:00.000Z",
      });
      const detail = () => ({
        finding: findingEntity(),
        company: {
          id: "company-juniper",
          organization_id: "org-harborline",
          name: "Juniper Ridge Dental",
          risk_score: 67,
          risk_level: "High" as const,
          created_at: "2026-08-20T18:00:00.000Z",
          updated_at: "2026-08-20T18:00:00.000Z",
        },
        remediations,
        verifications,
        evidence,
        audit_events: [],
      });
      const fetchMock = vi
        .fn()
        .mockImplementation(
          async (input: RequestInfo | URL, init?: RequestInit) => {
            const request =
              input instanceof Request
                ? input
                : new Request(String(input), init);
            const url = new URL(request.url);
            if (
              request.method === "GET" &&
              url.pathname === "/api/v1/dashboard"
            ) {
              return jsonResponse(dashboardForState());
            }
            if (
              request.method === "GET" &&
              url.pathname === "/api/v1/findings/SEC-5002"
            ) {
              return jsonResponse(detail());
            }
            if (
              request.method === "POST" &&
              url.pathname === "/api/v1/remediations"
            ) {
              const body =
                (await request.json()) as components["schemas"]["CreateRemediationRequest"];
              state = "Remediating";
              const remediation: components["schemas"]["Remediation"] = {
                id: "remediation-5002-b",
                finding_id: finding.id,
                status: "In progress",
                summary: body.summary,
                reference: body.reference,
                owner: body.owner,
                started_at: "2026-08-21T04:00:00.000Z",
                completed_at: null,
                created_at: "2026-08-21T04:00:00.000Z",
                updated_at: "2026-08-21T04:00:00.000Z",
              };
              remediations = [...remediations, remediation];
              return jsonResponse(remediation, 201);
            }
            if (
              request.method === "POST" &&
              url.pathname ===
                "/api/v1/remediations/remediation-5002-b/complete"
            ) {
              const body =
                (await request.json()) as components["schemas"]["CompleteRemediationRequest"];
              state = "Awaiting verification";
              const completed: components["schemas"]["Remediation"] = {
                ...remediations.at(-1)!,
                status: "Completed",
                summary: body.summary,
                reference: body.reference,
                completed_at: "2026-08-21T04:10:00.000Z",
                updated_at: "2026-08-21T04:10:00.000Z",
              };
              remediations = [...remediations.slice(0, -1), completed];
              return jsonResponse(completed);
            }
            if (
              request.method === "POST" &&
              url.pathname === "/api/v1/verifications"
            ) {
              const body =
                (await request.json()) as components["schemas"]["CreateVerificationRequest"];
              const run: components["schemas"]["VerificationRun"] = {
                id: "verification-5002-b",
                finding_id: finding.id,
                remediation_id: "remediation-5002-b",
                status: "Running",
                method: body.method,
                worker_name: "Authenticated verifier",
                credential_type: "session",
                execution_source: "authenticated-api",
                source_revision: body.source_revision,
                patch_digest: body.patch_digest,
                scope: body.scope,
                result_summary: "",
                started_at: "2026-08-21T04:20:00.000Z",
                completed_at: null,
                created_at: "2026-08-21T04:20:00.000Z",
              };
              const checks: components["schemas"]["VerificationCheck"][] =
                body.checks.map((name, index) => ({
                  id: `check-5002-b-${index + 1}`,
                  verification_id: run.id,
                  sequence: index + 1,
                  name,
                  status: "Pending",
                  message: "",
                  created_at: "2026-08-21T04:20:00.000Z",
                }));
              verifications = [...verifications, { verification: run, checks }];
              return jsonResponse({ verification: run, checks }, 201);
            }
            if (
              request.method === "POST" &&
              url.pathname ===
                "/api/v1/verifications/verification-5002-b/checks"
            ) {
              const body =
                (await request.json()) as components["schemas"]["CreateVerificationCheckRequest"];
              const current = verifications.at(-1)!;
              const recorded: components["schemas"]["VerificationCheck"] = {
                ...current.checks[0]!,
                status: body.status,
                message: body.message,
              };
              verifications = [
                ...verifications.slice(0, -1),
                { verification: current.verification, checks: [recorded] },
              ];
              return jsonResponse(recorded, 201);
            }
            if (
              request.method === "POST" &&
              url.pathname === "/api/v1/evidence/artifacts"
            ) {
              return jsonResponse(
                {
                  id: "artifact-5002-b",
                  content_hash: "0".repeat(64),
                  size_bytes: 24,
                  original_filename: "regression.txt",
                  scan_status: "Clean",
                  scanner: "test-scanner",
                  created_at: "2026-08-21T04:29:00.000Z",
                  retention_until: "2027-08-21T04:29:00.000Z",
                },
                201,
              );
            }
            if (
              request.method === "POST" &&
              url.pathname ===
                "/api/v1/verifications/verification-5002-b/complete"
            ) {
              passedBody = await request.json();
              state = "Verified fixed";
              const current = verifications.at(-1)!;
              const passed: components["schemas"]["VerificationRun"] = {
                ...current.verification,
                status: "Passed",
                result_summary: "All independent regression checks passed.",
                completed_at: "2026-08-21T04:30:00.000Z",
              };
              evidence = [
                {
                  id: "evidence-5002-b",
                  finding_id: finding.id,
                  verification_id: passed.id,
                  kind: "regression-output",
                  label: "Authorization regression proof",
                  source_reference: "artifact://verification-5002-b",
                  content_hash:
                    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                  artifact_id: "artifact-5002-b",
                  manifest_hash: "1".repeat(64),
                  manifest_signature: "2".repeat(64),
                  attested_by: "test-scanner",
                  metadata: { suite: "authorization" },
                  created_at: "2026-08-21T04:30:00.000Z",
                  locked_at: "2026-08-21T04:30:00.000Z",
                },
              ];
              verifications = [
                ...verifications.slice(0, -1),
                { verification: passed, checks: current.checks },
              ];
              return jsonResponse({
                verification: passed,
                finding: findingEntity(),
                evidence,
              });
            }
            throw new Error(
              `Unexpected request: ${request.method} ${url.pathname}`,
            );
          },
        );
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();

      render(<App />);
      await user.click(
        (
          await screen.findAllByRole("button", {
            name: "Start new remediation",
          })
        )[0]!,
      );
      let panel = within(
        await screen.findByRole("dialog", { name: "Remediation" }),
      );
      await user.clear(panel.getByLabelText("Remediation owner"));
      await user.type(panel.getByLabelText("Remediation owner"), "A. Rivera");
      await user.type(
        panel.getByLabelText("Remediation summary"),
        "Close the secondary authorization path.",
      );
      await user.type(
        panel.getByLabelText("Remediation reference"),
        "PR-5002-b",
      );
      await user.click(
        panel.getByRole("button", { name: "Start remediation" }),
      );
      await waitFor(() =>
        expect(panel.getByText("remediation-5002-b")).toBeInTheDocument(),
      );

      await user.type(
        panel.getByLabelText("Completion summary"),
        "Merged the secondary path fix.",
      );
      await user.type(
        panel.getByLabelText("Completion reference"),
        "commit-5002-b",
      );
      await user.click(
        panel.getByRole("button", { name: "Complete remediation" }),
      );
      await waitFor(() => {
        const row = screen.getAllByText("SEC-5002")[0]!.closest("tr");
        expect(row).not.toBeNull();
        expect(
          within(row!).getByText("Awaiting verification"),
        ).toBeInTheDocument();
      });
      await user.click(
        panel.getByRole("button", { name: "Close remediation" }),
      );

      await user.click(
        (
          await screen.findAllByRole("button", { name: "Review verification" })
        )[0]!,
      );
      const drawer = within(
        await screen.findByRole("dialog", { name: "Verification" }),
      );
      expect(
        drawer.getByText("First patch left a secondary path open."),
      ).toBeInTheDocument();
      expect(
        drawer.getByText("Secondary query path remains exploitable."),
      ).toBeInTheDocument();

      await user.type(
        drawer.getByLabelText("Verification method"),
        "Regression test",
      );
      await user.type(
        drawer.getByLabelText("Source revision"),
        "commit-5002-b",
      );
      await user.type(drawer.getByLabelText("Patch SHA-256"), "b".repeat(64));
      await user.type(
        drawer.getByLabelText("Verification scope"),
        "Authorization boundary",
      );
      await user.type(
        drawer.getByLabelText("Expected checks"),
        "Authorization regression",
      );
      await user.click(
        drawer.getByRole("button", { name: "Create verification" }),
      );
      await waitFor(() => {
        expect(
          drawer.getAllByText("verification-5002-b").length,
        ).toBeGreaterThan(0);
      });

      await user.selectOptions(
        drawer.getByLabelText("Result for Authorization regression"),
        "Passed",
      );
      await user.type(
        drawer.getByLabelText("Message for Authorization regression"),
        "Regression no longer reproduces.",
      );
      await user.click(
        drawer.getByRole("button", { name: "Record Authorization regression" }),
      );
      await waitFor(() => {
        expect(
          drawer.getByRole("button", { name: "Complete passed verification" }),
        ).toBeInTheDocument();
      });

      await user.type(
        drawer.getByLabelText("Verification result summary"),
        "All independent regression checks passed.",
      );
      await user.clear(drawer.getByLabelText("Evidence kind"));
      await user.type(
        drawer.getByLabelText("Evidence kind"),
        "regression-output",
      );
      await user.type(
        drawer.getByLabelText("Evidence label"),
        "Authorization regression proof",
      );
      await user.type(
        drawer.getByLabelText("Evidence source reference"),
        "artifact://verification-5002-b",
      );
      expect(drawer.getByLabelText("Evidence metadata")).toHaveValue("{}");
      await user.upload(
        drawer.getByLabelText("Evidence artifact"),
        new File(["authorization regression"], "regression.txt", {
          type: "text/plain",
        }),
      );
      await user.click(
        drawer.getByRole("button", { name: "Complete passed verification" }),
      );

      await waitFor(() => {
        expect(
          fetchMock.mock.calls.some(([input]) =>
            String(input).includes("/api/v1/evidence/artifacts"),
          ),
        ).toBe(true);
      });
      await waitFor(() => {
        expect(passedBody).toEqual({
          result: "Passed",
          summary: "All independent regression checks passed.",
          evidence: [
            {
              artifact_id: "artifact-5002-b",
              kind: "regression-output",
              label: "Authorization regression proof",
              source_reference: "artifact://verification-5002-b",
              metadata: {},
            },
          ],
        });
      });
      expect(
        await drawer.findByText("Verified fixed. Evidence bundle locked."),
      ).toBeInTheDocument();
      expect(
        drawer.getAllByText("First patch left a secondary path open.").length,
      ).toBeGreaterThan(0);
      expect(
        drawer.getAllByText("Secondary query path remains exploitable.").length,
      ).toBeGreaterThan(0);
      expect(drawer.getAllByText(/evidence-5002-b/).length).toBeGreaterThan(0);
      await waitFor(() => {
        const row = screen.getAllByText("SEC-5002")[0]!.closest("tr");
        expect(row).not.toBeNull();
        expect(within(row!).getByText("Verified fixed")).toBeInTheDocument();
      });
    }, 20_000);

    it("renders persisted locked evidence with provenance fields from the API", async () => {
      const evidence: components["schemas"]["EvidenceItem"] = {
        id: "evidence-api-7001",
        finding_id: "finding-api-7001",
        verification_id: "verification-api-7001",
        kind: "regression-output",
        label: "Authorization regression proof",
        source_reference: "artifact://verification-api-7001",
        content_hash:
          "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        artifact_id: "artifact-api-7001",
        manifest_hash: "1".repeat(64),
        manifest_signature: "2".repeat(64),
        attested_by: "clamav-instream",
        metadata: { suite: "authorization" },
        created_at: "2026-08-21T05:00:00.000Z",
        locked_at: "2026-08-21T05:00:01.000Z",
      };
      const fetchMock = vi
        .fn()
        .mockImplementation(
          async (input: RequestInfo | URL, init?: RequestInit) => {
            const request =
              input instanceof Request
                ? input
                : new Request(String(input), init);
            const url = new URL(request.url);
            if (
              request.method === "GET" &&
              url.pathname === "/api/v1/dashboard"
            ) {
              return jsonResponse(dashboardFixture);
            }
            if (
              request.method === "GET" &&
              url.pathname === "/api/v1/evidence"
            ) {
              return jsonResponse([
                {
                  ...evidence,
                  id: "evidence-api-older",
                  verification_id: "verification-api-older",
                  label: "Older persisted proof",
                  source_reference: "artifact://verification-api-older",
                  content_hash:
                    "1111111111111111111111111111111111111111111111111111111111111111",
                  created_at: "2026-08-20T05:00:00.000Z",
                  locked_at: "2026-08-20T05:00:01.000Z",
                },
                evidence,
              ]);
            }
            throw new Error(
              `Unexpected request: ${request.method} ${url.pathname}`,
            );
          },
        );
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();

      render(<App />);
      await user.click(screen.getByRole("button", { name: "Evidence" }));

      expect(
        await screen.findByText("Authorization regression proof"),
      ).toBeInTheDocument();
      expect(screen.getByText("evidence-api-7001")).toBeInTheDocument();
      expect(
        screen.getByText("artifact://verification-api-7001"),
      ).toBeInTheDocument();
      expect(screen.getByText("verification-api-7001")).toBeInTheDocument();
      expect(screen.getByText(evidence.content_hash)).toBeInTheDocument();
      expect(screen.getAllByText("Locked evidence").length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Created/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Locked at/).length).toBeGreaterThan(0);
      const latest = screen
        .getByText("Authorization regression proof")
        .closest("article");
      const older = screen
        .getByText("Older persisted proof")
        .closest("article");
      expect(latest).not.toBeNull();
      expect(older).not.toBeNull();
      expect(
        latest!.compareDocumentPosition(older!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("generates an immutable report snapshot and exposes the API Markdown download", async () => {
      const newReport: components["schemas"]["Report"] = {
        ...dashboardFixture.latest_report!,
        id: "report-api-2",
        title: "September Security Review",
        period_label: "September 2026",
        snapshot: {
          ...dashboardFixture.latest_report!.snapshot,
          verified_fixes: 10,
        },
        generated_at: "2026-08-21T05:15:00.000Z",
        created_at: "2026-08-21T05:15:00.000Z",
      };
      let latestReport = dashboardFixture.latest_report;
      let reportBody: unknown;
      const fetchMock = vi
        .fn()
        .mockImplementation(
          async (input: RequestInfo | URL, init?: RequestInit) => {
            const request =
              input instanceof Request
                ? input
                : new Request(String(input), init);
            const url = new URL(request.url);
            if (
              request.method === "GET" &&
              url.pathname === "/api/v1/dashboard"
            ) {
              return jsonResponse({
                ...dashboardFixture,
                latest_report: latestReport,
              });
            }
            if (
              request.method === "POST" &&
              url.pathname === "/api/v1/reports"
            ) {
              reportBody = await request.json();
              latestReport = newReport;
              return jsonResponse(newReport, 201);
            }
            throw new Error(
              `Unexpected request: ${request.method} ${url.pathname}`,
            );
          },
        );
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();

      render(<App />);
      await user.click(screen.getByRole("button", { name: "Reports" }));
      await user.click(
        await screen.findByRole("button", { name: "Generate report" }),
      );
      const dialog = within(
        screen.getByRole("dialog", { name: "Generate report" }),
      );
      await user.selectOptions(
        dialog.getByLabelText("Company"),
        "company-juniper",
      );
      await user.type(dialog.getByLabelText("Period label"), "September 2026");
      await user.click(dialog.getByRole("button", { name: "Generate report" }));

      expect(reportBody).toEqual({
        company_id: "company-juniper",
        period_label: "September 2026",
      });
      expect(
        await screen.findByText("September Security Review"),
      ).toBeInTheDocument();
      const download = screen.getByRole("link", { name: "Download Markdown" });
      expect(download).toHaveAttribute(
        "href",
        "/api/v1/reports/report-api-2/download",
      );
      expect(
        screen.queryByRole("dialog", { name: "Generate report" }),
      ).not.toBeInTheDocument();
    });
  });
});
