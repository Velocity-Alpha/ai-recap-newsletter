import { beforeEach, describe, expect, it, vi } from "vitest";

type IssueRow = {
  id: bigint;
  slug: string | null;
  title: string;
  excerpt: string | null;
  featureImageUrl: string | null;
  contentJson: unknown;
  issueDate: Date | null;
  publishedAt: Date | null;
};

const PUBLISHED: IssueRow = {
  id: 1n,
  slug: "published-issue",
  title: "Published issue",
  excerpt: "Summary",
  featureImageUrl: null,
  contentJson: {},
  issueDate: new Date("2026-11-04T00:00:00.000Z"),
  publishedAt: new Date("2026-11-04T14:00:00.000Z"),
};

const UNPUBLISHED: IssueRow = {
  id: 2n,
  slug: "unpublished-issue",
  title: "Unpublished issue",
  excerpt: null,
  featureImageUrl: null,
  contentJson: {},
  issueDate: new Date("2026-11-05T00:00:00.000Z"),
  publishedAt: null,
};

// A tiny stand-in for the issues table. It applies the `where` filter like the database would,
// and fails loudly on filter shapes it does not understand.
const { prismaMock } = vi.hoisted(() => {
  const rows: IssueRow[] = [];

  function matches(row: IssueRow, where: Record<string, unknown>) {
    return Object.entries(where).every(([field, condition]) => {
      const value = row[field as keyof IssueRow];
      if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
        if (Object.keys(condition).length === 1 && (condition as { not?: unknown }).not === null) {
          return value !== null;
        }
        throw new Error(`Unsupported filter on ${field}`);
      }
      return value === condition;
    });
  }

  return {
    prismaMock: {
      rows,
      issue: {
        findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          rows.find((row) => matches(row, where)) ?? null,
        ),
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
          rows.find((row) => matches(row, where)) ?? null,
        ),
      },
    },
  };
});

vi.mock("@/src/server/prisma", () => ({ prisma: prismaMock }));
vi.mock("next/cache", () => ({
  unstable_cache: (callback: (...args: unknown[]) => Promise<unknown>) => callback,
}));

import { GET as getIssueBySlug } from "@/app/api/issues/[slug]/route";
import { GET as getNewsletterById } from "@/app/api/newsletters/[id]/route";
import { fetchNewsletterIssueById, fetchNewsletterIssueBySlug } from "@/src/features/newsletter/server";

function requestById(id: string) {
  return getNewsletterById(new Request(`http://localhost/api/newsletters/${id}`), {
    params: Promise.resolve({ id }),
  });
}

function requestBySlug(slug: string) {
  return getIssueBySlug(new Request(`http://localhost/api/issues/${slug}`), {
    params: Promise.resolve({ slug }),
  });
}

describe("public issue lookups serve published issues only", () => {
  beforeEach(() => {
    prismaMock.rows.splice(0, prismaMock.rows.length, PUBLISHED, UNPUBLISHED);
  });

  it("GET /api/newsletters/[id] returns 404 for an unpublished issue", async () => {
    const response = await requestById("2");

    expect(response.status).toBe(404);
  });

  it("GET /api/newsletters/[id] returns a published issue", async () => {
    const response = await requestById("1");
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.slug).toBe("published-issue");
  });

  it("GET /api/issues/[slug] returns 404 for an unpublished issue", async () => {
    const response = await requestBySlug("unpublished-issue");

    expect(response.status).toBe(404);
  });

  it("GET /api/issues/[slug] returns a published issue", async () => {
    const response = await requestBySlug("published-issue");
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.id).toBe(1);
  });

  it("issue pages get nothing for an unpublished issue", async () => {
    await expect(fetchNewsletterIssueById("2")).resolves.toBeNull();
    await expect(fetchNewsletterIssueBySlug("unpublished-issue")).resolves.toBeNull();
  });

  it("issue pages still load a published issue", async () => {
    await expect(fetchNewsletterIssueById("1")).resolves.toMatchObject({ slug: "published-issue" });
    await expect(fetchNewsletterIssueBySlug("published-issue")).resolves.toMatchObject({ id: 1 });
  });
});
