import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./app/App";
import { dashboardFixture } from "./test/fixtures";

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
      await screen.findByText("Unable to load remediation workspace"),
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
});
