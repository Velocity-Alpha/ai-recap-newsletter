import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Next's own matcher check. Imported from its file: the "next/experimental/testing/server" entry also loads
// config-testing-utils, which breaks route handler calls later in this file (AsyncLocalStorage invariant).
import { unstable_doesMiddlewareMatch } from "next/dist/experimental/testing/server/middleware-testing-utils";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Acceptance check for #54: no admin page or admin API works without the approval login.
 * It finds every file under app/admin and every route under app/api/admin on disk, so a new page or route
 * is covered without editing this file, and an unreviewed kind of file fails the test.
 */

const cookieJar = vi.hoisted(() => ({ token: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "approval_session" && cookieJar.token !== undefined ? { name, value: cookieJar.token } : undefined,
  }),
}));

// Every Prisma call is recorded. Reads return empty results and writes return a row, so signed-in calls work.
const db = vi.hoisted(() => {
  const calls: string[] = [];
  const emptyResult = (method: string) => {
    if (method === "findMany") return [];
    if (method === "count") return 0;
    if (["create", "update", "upsert"].includes(method)) return { id: 1n };
    return null;
  };
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, method) =>
          typeof method !== "string" || method === "then"
            ? undefined
            : async () => {
                calls.push(`${name}.${method}`);
                return emptyResult(method);
              },
      },
    );
  const prisma: Record<string, unknown> = new Proxy(
    {},
    {
      get: (_target, name) => {
        if (typeof name !== "string" || name === "then") return undefined;
        if (name === "$transaction") {
          return async (fn: (tx: unknown) => unknown) => {
            calls.push("$transaction");
            return fn(prisma);
          };
        }
        return model(name);
      },
    },
  );
  return { calls, prisma };
});

vi.mock("@/src/server/prisma", () => ({ prisma: db.prisma }));

import { config as proxyConfig, proxy } from "@/proxy";
import { APPROVAL_SESSION_COOKIE_NAME, createApprovalSessionToken } from "@/src/server/approval-auth";

const ROOT = path.resolve(__dirname, "../..");
const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const SOURCE = "[cm]?[jt]sx?";

function filesUnder(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(ROOT, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
}

/** Matches a Next special file such as `page.tsx` or `route.ts` (not `route.test.ts`). */
function named(name: string): RegExp {
  return new RegExp(`/${name}\\.${SOURCE}$`);
}

/** app/admin/runs/[id]/page.tsx -> { url: "/admin/runs/1", params: { id: "1" } } */
function routeOf(file: string) {
  const segments = path.posix.dirname(file).split("/").slice(1).filter((segment) => !/^\(.*\)$/.test(segment));
  const params: Record<string, string> = {};
  const url = `/${segments
    .map((segment) => {
      const dynamic = segment.match(/^\[(?:\.\.\.)?(.+)\]$/);
      if (!dynamic) return segment;
      params[dynamic[1]] = "1";
      return "1";
    })
    .join("/")}`;
  return { file, url, params };
}

const APP_ADMIN_FILES = filesUnder("app/admin");
const PAGES = APP_ADMIN_FILES.filter((file) => named("page").test(file)).map(routeOf);
const LAYOUTS = APP_ADMIN_FILES.filter((file) => named("layout").test(file)).map(routeOf);
// A route handler under app/admin is as reachable as one under app/api/admin, so both trees are checked.
const ROUTES = [...APP_ADMIN_FILES, ...filesUnder("app/api/admin")]
  .filter((file) => named("route").test(file))
  .map(routeOf);

/**
 * The only files allowed under app/admin, each with the check that covers it. Any other special file
 * (loading, template, not-found, default, opengraph-image, sitemap...) or plain module fails the test until
 * it is reviewed and a check is added here.
 */
const ALLOWED_IN_APP_ADMIN: Array<{ pattern: RegExp; coveredBy: string }> = [
  { pattern: named("page"), coveredBy: "redirects to the login without a session" },
  { pattern: named("layout"), coveredBy: "reads no data" },
  { pattern: named("route"), coveredBy: "answers 401 without a session" },
  { pattern: named("error"), coveredBy: "client error boundary; admin-pages.test.tsx shows it prints no error details" },
  { pattern: new RegExp(`\\.test\\.${SOURCE}$`), coveredBy: "tests" },
];

type Props = { params: Promise<Record<string, string>>; searchParams: Promise<Record<string, string>> };
type PageModule = {
  default: (props: unknown) => unknown;
  generateMetadata?: (props: Props, parent: unknown) => unknown;
};
type RouteModule = Partial<
  Record<(typeof HTTP_METHODS)[number], (request: Request, context: unknown) => Promise<Response>>
>;

function propsFor(entry: { params: Record<string, string> }): Props {
  return { params: Promise.resolve(entry.params), searchParams: Promise.resolve({}) };
}

/** Runs a server function and says whether it redirected (and where) or threw something else. */
async function outcome(run: () => unknown): Promise<{ redirectedTo: string | null; error: unknown }> {
  try {
    await run();
    return { redirectedTo: null, error: null };
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    // next/navigation's redirect() throws with digest "NEXT_REDIRECT;<type>;<url>;<status>;".
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) {
      return { redirectedTo: digest.split(";")[2], error: null };
    }
    return { redirectedTo: null, error };
  }
}

async function load(file: string): Promise<PageModule> {
  return (await import(/* @vite-ignore */ path.join(ROOT, file))) as PageModule;
}

async function renderPage(page: (typeof PAGES)[number]) {
  const mod = await load(page.file);
  return outcome(() => mod.default(propsFor(page)));
}

async function callRoute(route: (typeof ROUTES)[number]) {
  const mod = (await import(/* @vite-ignore */ path.join(ROOT, route.file))) as RouteModule;
  const handlers = HTTP_METHODS.filter((method) => typeof mod[method] === "function");
  const results: Array<{ method: string; status: number }> = [];
  for (const method of handlers) {
    const hasBody = method !== "GET" && method !== "HEAD";
    const request = new Request(`http://localhost${route.url}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(cookieJar.token ? { cookie: `${APPROVAL_SESSION_COOKIE_NAME}=${cookieJar.token}` } : {}),
      },
      ...(hasBody ? { body: JSON.stringify({ key: "ingest.owner", value: "native" }) } : {}),
    });
    const response = await mod[method]!(request, { params: Promise.resolve(route.params) });
    results.push({ method, status: response.status });
  }
  return results;
}

const NO_SESSION_CASES: Array<{ name: string; arrange: () => Promise<void> }> = [
  { name: "no cookie", arrange: async () => {} },
  {
    name: "a forged cookie",
    arrange: async () => {
      cookieJar.token = `${Date.now() + 60_000}.${"a".repeat(32)}.${"b".repeat(64)}`;
    },
  },
  {
    name: "an expired session",
    arrange: async () => {
      cookieJar.token = await createApprovalSessionToken(undefined, new Date(Date.now() - 25 * 60 * 60 * 1000));
    },
  },
  {
    name: "a session signed with another SESSION_SECRET",
    arrange: async () => {
      vi.stubEnv("SESSION_SECRET", "another-secret");
      cookieJar.token = await createApprovalSessionToken();
      vi.stubEnv("SESSION_SECRET", "test-session-secret");
    },
  },
  {
    name: "a valid session while the login is not configured",
    arrange: async () => {
      cookieJar.token = await createApprovalSessionToken();
      vi.stubEnv("APPROVAL_PASSWORD", "");
    },
  },
];

describe("admin access (#54)", () => {
  beforeEach(() => {
    vi.stubEnv("APPROVAL_PASSWORD", "approval-secret");
    vi.stubEnv("SESSION_SECRET", "test-session-secret");
    cookieJar.token = undefined;
    db.calls.length = 0;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("finds every admin page and admin API route", () => {
    expect(PAGES.map((page) => page.url)).toEqual(
      expect.arrayContaining(["/admin", "/admin/runs", "/admin/runs/1", "/admin/incidents", "/admin/settings"]),
    );
    expect(LAYOUTS.map((layout) => layout.url)).toEqual(["/admin"]);
    expect(ROUTES.map((route) => route.url)).toEqual(expect.arrayContaining(["/api/admin/stage-switches"]));
  });

  it("allows only reviewed kinds of file under app/admin", () => {
    const unreviewed = APP_ADMIN_FILES.filter(
      (file) => !ALLOWED_IN_APP_ADMIN.some(({ pattern }) => pattern.test(file)),
    );

    expect(unreviewed).toEqual([]);
  });

  describe.each(NO_SESSION_CASES)("with $name", ({ arrange }) => {
    it.each(PAGES)("page $url sends the visitor to the login and reads no data", async (page) => {
      await arrange();

      const { redirectedTo, error } = await renderPage(page);

      expect(error).toBeNull();
      expect(redirectedTo).toBe(`/approval/login?redirect=${encodeURIComponent(page.url)}`);
      expect(db.calls).toEqual([]);
    });

    it.each([...PAGES, ...LAYOUTS])("$file: generateMetadata, if exported, reads no data", async (entry) => {
      await arrange();
      const mod = await load(entry.file);
      if (typeof mod.generateMetadata !== "function") return;

      const { redirectedTo, error } = await outcome(() => mod.generateMetadata!(propsFor(entry), {}));

      // Either it is guarded (redirects to the login) or it stays away from the database.
      if (redirectedTo === null) expect(error).toBeNull();
      else expect(redirectedTo).toMatch(/^\/approval\/login\?/);
      expect(db.calls).toEqual([]);
    });

    it.each(LAYOUTS)("layout $url reads no data", async (layout) => {
      await arrange();
      const mod = await load(layout.file);

      const { error } = await outcome(() => mod.default({ children: null, params: Promise.resolve(layout.params) }));

      expect(error).toBeNull();
      expect(db.calls).toEqual([]);
    });

    it.each(ROUTES)("route $url answers 401 for every method and touches no data", async (route) => {
      await arrange();

      const results = await callRoute(route);

      expect(results.length).toBeGreaterThan(0);
      for (const result of results) expect(result).toEqual({ method: result.method, status: 401 });
      expect(db.calls).toEqual([]);
    });
  });

  describe("with a valid session (control: the checks above are not vacuous)", () => {
    it.each(PAGES)("page $url does not redirect to the login", async (page) => {
      cookieJar.token = await createApprovalSessionToken();

      const { redirectedTo, error } = await renderPage(page);

      expect(redirectedTo).toBeNull();
      // A missing record may answer 404 (notFound); anything else is a real failure.
      if (error) expect((error as { digest?: string }).digest).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
    });

    it.each(ROUTES)("route $url does not answer 401", async (route) => {
      cookieJar.token = await createApprovalSessionToken();

      for (const result of await callRoute(route)) expect(result.status).not.toBe(401);
    });
  });

  it("the proxy runs on every admin URL and stops it without a session", async () => {
    const urls = ["/admin", "/api/admin", ...PAGES.map((page) => page.url), ...ROUTES.map((route) => route.url)];

    for (const url of urls) {
      expect(unstable_doesMiddlewareMatch({ config: proxyConfig, url }), url).toBe(true);

      const response = await proxy(new NextRequest(`http://localhost${url}`, { method: "POST" }));
      if (url.startsWith("/api/")) {
        expect(response.status, url).toBe(401);
      } else {
        expect(response.status, url).toBe(307);
        expect(new URL(response.headers.get("location")!).pathname).toBe("/approval/login");
      }
    }
  });

  it("has no server actions: they are public POST endpoints, so admin changes go through /api/admin routes", () => {
    const adminCode = ["app/admin", "app/api/admin", "src/features/admin", "src/components/admin"].flatMap(filesUnder);
    const withActions = adminCode.filter(
      (file) =>
        new RegExp(`\\.${SOURCE}$`).test(file) &&
        /^\s*["']use server["']/m.test(readFileSync(path.join(ROOT, file), "utf8")),
    );

    expect(withActions).toEqual([]);
  });
});
