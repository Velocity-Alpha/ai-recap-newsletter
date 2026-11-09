import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Renders each admin page with fixture rows. Access control is covered by admin-access.test.ts. */

vi.mock("@/src/server/admin-auth", () => ({ requireAdminPage: vi.fn(async () => ({ actor: "approval login" })) }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/admin/settings",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const prismaMock = vi.hoisted(() => ({
  pipelineRun: { findMany: vi.fn(), findUnique: vi.fn() },
  pipelineSetting: { findMany: vi.fn() },
  alert: { findMany: vi.fn() },
}));

vi.mock("@/src/server/prisma", () => ({ prisma: prismaMock }));

import AdminErrorPage from "@/app/admin/error";
import AdminOverviewPage from "@/app/admin/page";
import AdminIncidentsPage from "@/app/admin/incidents/page";
import AdminRunPage from "@/app/admin/runs/[id]/page";
import AdminRunsPage from "@/app/admin/runs/page";
import AdminSettingsPage from "@/app/admin/settings/page";

const T = new Date("2026-11-09T14:55:00Z");
const later = (ms: number) => new Date(T.getTime() + ms);

const RUNS = [
  {
    id: 9n,
    job: "ingest-stories",
    trigger: "schedule",
    status: "failed",
    startedAt: T,
    finishedAt: later(16_200),
    stats: { storiesSaved: 41, telegram: "sent", sources: [{}, {}] },
    error: "1 source(s) had errors: Source B.",
  },
  {
    id: 8n,
    job: "admin-setting",
    trigger: "manual",
    status: "succeeded",
    startedAt: T,
    finishedAt: T,
    stats: { key: "ingest.owner", from: null, to: "native", by: "approval login" },
    error: null,
  },
];

const OPEN_ALERT = {
  id: 3n,
  incidentKey: "stories-missing:2026-11-09",
  openIncidentKey: "stories-missing:2026-11-09",
  severity: "critical",
  status: "open",
  firstSeen: later(600_000),
  lastSeen: later(7_200_000),
  notifiedAt: later(600_000),
  resolvedAt: null,
  message: "No stories for today",
  context: { evidence: "0 stories by 10:05", link: "https://airecap.news/admin/runs/9" },
};

async function render(page: Promise<React.ReactElement>) {
  return renderToStaticMarkup(await page);
}

describe("admin pages render", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.pipelineRun.findMany.mockImplementation(async (args: { where: { job?: string } }) =>
      args.where.job === "admin-setting" ? [RUNS[1]] : RUNS,
    );
    prismaMock.pipelineSetting.findMany.mockResolvedValue([
      { key: "ingest.owner", value: "native", updatedAt: T },
      { key: "pipeline.runner", value: "netlify", updatedAt: T },
      { key: "publish.owner", value: "native", updatedAt: T },
    ]);
    prismaMock.alert.findMany.mockImplementation(async (args: { where: { status: string } }) =>
      args.where.status === "open" ? [OPEN_ALERT] : [],
    );
  });

  it("/admin/runs lists runs with status, duration, stats, and a link to each", async () => {
    const html = await render(AdminRunsPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('href="/admin/runs/9"');
    expect(html).toContain("ingest-stories");
    expect(html).toContain("failed");
    expect(html).toContain("16.2 s");
    expect(html).toContain("storiesSaved 41 · telegram sent · sources 2");
    expect(html).toContain("Mon, Nov 9, 9:55:00 AM EST");
  });

  it("/admin/runs/[id] shows the run and its steps", async () => {
    prismaMock.pipelineRun.findUnique.mockResolvedValueOnce({
      ...RUNS[0],
      events: [
        { id: 1n, runId: 9n, level: "info", step: "source", message: "Source A: ok", data: null, createdAt: later(5_000) },
        { id: 2n, runId: 9n, level: "error", step: "source", message: "Source B: failed.", data: { tries: 2 }, createdAt: later(9_000) },
      ],
      _count: { events: 2 },
    });

    const html = await render(AdminRunPage({ params: Promise.resolve({ id: "9" }) }));

    expect(html).toContain("Run #9");
    expect(html).toContain("1 source(s) had errors: Source B.");
    expect(html.indexOf("Source A: ok")).toBeLessThan(html.indexOf("Source B: failed."));
    expect(html).toContain("&quot;tries&quot;: 2");
    expect(html).toContain("2 in order");
    expect(html).not.toContain("not shown");
  });

  it("/admin/runs/[id] shows the first 500 steps and says how many more there are", async () => {
    const events = Array.from({ length: 500 }, (_, index) => ({
      id: BigInt(index + 1),
      runId: 9n,
      level: "info",
      step: "poll",
      message: "Poll " + (index + 1),
      data: null,
      createdAt: later(index * 1_000),
    }));
    prismaMock.pipelineRun.findUnique.mockResolvedValueOnce({ ...RUNS[0], events, _count: { events: 1234 } });

    const html = await render(AdminRunPage({ params: Promise.resolve({ id: "9" }) }));

    expect(html).toContain("Poll 500");
    expect(html).toContain("first 500 of 1,234");
    expect(html).toContain("734 more steps not shown.");
  });

  it("the admin error page offers a retry and prints no error details", () => {
    const error = Object.assign(new Error("connect ECONNREFUSED db.internal:5432"), { digest: "abc123" });

    const html = renderToStaticMarkup(<AdminErrorPage error={error} reset={() => {}} />);

    expect(html).toContain("This page could not load. Try again in a moment.");
    expect(html).toContain("Try again");
    expect(html).not.toContain("ECONNREFUSED");
    expect(html).not.toContain("db.internal");
    expect(html).not.toContain("abc123");
  });

  it("/admin/incidents shows key, severity, times, message, evidence, and a local link", async () => {
    const html = await render(AdminIncidentsPage());

    expect(html).toContain("stories-missing:2026-11-09");
    expect(html).toContain("critical");
    expect(html).toContain("No stories for today");
    expect(html).toContain("0 stories by 10:05");
    expect(html).toContain('href="/admin/runs/9"');
    expect(html).toContain("First seen");
    expect(html).toContain("Mon, Nov 9, 10:05:00 AM EST");
    expect(html).toContain("Mon, Nov 9, 11:55:00 AM EST");
    expect(html).toContain("Nothing resolved yet.");
  });

  it("/admin/settings shows every row, the switches, and the change log", async () => {
    const html = await render(AdminSettingsPage());

    for (const key of ["ingest.owner", "pipeline.runner", "publish.owner", "draft.owner"]) expect(html).toContain(key);
    expect(html).toContain("&quot;netlify&quot;");
    expect(html).toContain("Switch to n8n");
    expect(html).toContain("Native drafting is not built yet (#79)");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Switch to Native<\/button>/);
    expect(html).toContain("Not set. The jobs use n8n.");
    expect(html).toContain("not set → <strong>native</strong>");
    // The confirmation appears only after a click.
    expect(html).not.toContain("Yes, switch to");
  });

  it("/admin shows stage owners, open incidents, and the latest runs", async () => {
    const html = await render(AdminOverviewPage());

    expect(html).toContain("1 open incident");
    expect(html).toContain("No stories for today");
    expect(html).toContain('href="/admin/runs/8"');
    expect(html).toContain("Native");
  });
});
