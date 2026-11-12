// Public pages are signed-out pages: the CDN caches one copy for everyone, and the browser decides whether to
// show the subscriber view. A page that reads cookies or headers on the server becomes dynamic and loses the
// CDN cache, so here cookies() and headers() throw.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toIssueContentJson } from "@/src/pipeline/draft/content";
import { SAMPLE_CONTENT, SAMPLE_DRAFT, SAMPLE_ISSUE } from "@/src/pipeline/draft/draft.fixture";

const repository = vi.hoisted(() => ({
  fetchNewsletterListPage: vi.fn(),
  fetchTickerFeed: vi.fn(),
  fetchNewsletterIssueApiResponseBySlug: vi.fn(),
  fetchNewsletterIssueApiResponseById: vi.fn(),
  fetchPublishedNewsletterEntries: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: () => {
    throw new Error("A public page read cookies() on the server");
  },
  headers: () => {
    throw new Error("A public page read headers() on the server");
  },
}));

vi.mock("next/cache", () => ({
  unstable_cache: (callback: (...args: unknown[]) => Promise<unknown>) => callback,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean; fill?: boolean }) => {
    const { priority, fill, alt, ...imageProps } = props;
    void priority;
    void fill;

    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={alt ?? ""} {...imageProps} />;
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/src/features/newsletter/repository", () => repository);
vi.mock("@/src/server/prisma", () => ({ prisma: {} }));

import HomePage from "@/app/page";
import ArchivePage from "@/app/archive/page";
import ArchivePageN from "@/app/archive/page/[page]/page";
import IssuePage from "@/app/issue/[slug]/page";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import ForBrandsPage from "@/app/for-brands/page";

const ISSUE_SLUG = "pretend-lab-teaches-models-to-plan";
const LAST_QUICK_HIT = SAMPLE_CONTENT.quick_hits.at(-1)!;

const listPage = {
  data: [
    {
      id: String(SAMPLE_ISSUE.id),
      slug: ISSUE_SLUG,
      title: SAMPLE_CONTENT.title,
      excerpt: SAMPLE_CONTENT.excerpt,
      issue_date: SAMPLE_ISSUE.issueDate,
      published_at: "2027-01-04T16:00:00.000Z",
      feature_image_url: null,
    },
  ],
  pagination: {
    currentPage: 1,
    totalPages: 1,
    totalCount: 1,
    limit: 6,
    hasNextPage: false,
    hasPreviousPage: false,
  },
};

const issueResponse = {
  id: SAMPLE_ISSUE.id,
  slug: ISSUE_SLUG,
  title: SAMPLE_CONTENT.title,
  excerpt: SAMPLE_CONTENT.excerpt,
  feature_image_url: SAMPLE_DRAFT.featuredImageUrl,
  issue_date: SAMPLE_ISSUE.issueDate,
  published_at: "2027-01-04T16:00:00.000Z",
  content_json: toIssueContentJson(SAMPLE_CONTENT, {
    issueId: SAMPLE_ISSUE.id,
    issueDate: SAMPLE_ISSUE.issueDate,
    featuredImageUrl: SAMPLE_DRAFT.featuredImageUrl,
  }),
};

const SIGNED_OUT_ONLY = "data-signed-out-only";

async function render(page: Promise<ReactElement> | ReactElement) {
  return renderToStaticMarkup(await page);
}

describe("public pages render the signed-out view without reading cookies", () => {
  beforeEach(() => {
    repository.fetchNewsletterListPage.mockReset().mockResolvedValue(listPage);
    repository.fetchTickerFeed.mockReset().mockResolvedValue({
      data: [{ headline: "A ticker headline" }],
      stats: { stories: 1, tools: 0, papers: 0 },
      count: 1,
    });
    repository.fetchNewsletterIssueApiResponseBySlug.mockReset().mockResolvedValue(issueResponse);
  });

  it("renders the home page with its Subscribe buttons and form marked signed-out only", async () => {
    const html = await render(HomePage());

    expect(html).toContain(SAMPLE_CONTENT.title);
    expect(html).toMatch(new RegExp(`<button[^>]*${SIGNED_OUT_ONLY}[^>]*>Subscribe Free<`));
    expect(html).toMatch(new RegExp(`<section[^>]*id="subscribe"[^>]*${SIGNED_OUT_ONLY}|<section[^>]*${SIGNED_OUT_ONLY}[^>]*id="subscribe"`));
    expect(html).toMatch(new RegExp(`<a[^>]*href="/#subscribe"[^>]*${SIGNED_OUT_ONLY}|<li[^>]*${SIGNED_OUT_ONLY}[^>]*><a[^>]*href="/#subscribe"`));
  });

  it("renders the archive with the subscribe form marked signed-out only", async () => {
    const html = await render(ArchivePage());

    expect(html).toContain(SAMPLE_CONTENT.title);
    expect(html).toContain(SIGNED_OUT_ONLY);
    expect(html).toMatch(new RegExp(`<section[^>]*${SIGNED_OUT_ONLY}[^>]*id="subscribe"|<section[^>]*id="subscribe"[^>]*${SIGNED_OUT_ONLY}`));
  });

  it("renders archive page N with the subscribe form marked signed-out only", async () => {
    repository.fetchNewsletterListPage.mockResolvedValue(pageOf(2, 3));

    const html = await render(ArchivePageN({ params: Promise.resolve({ page: "2" }) }));

    expect(repository.fetchNewsletterListPage).toHaveBeenCalledWith(2, 6);
    expect(html).toContain(SAMPLE_CONTENT.title);
    expect(html).toMatch(new RegExp(`<section[^>]*${SIGNED_OUT_ONLY}[^>]*id="subscribe"|<section[^>]*id="subscribe"[^>]*${SIGNED_OUT_ONLY}`));
    expect(html).toContain('href="/archive/page/3"');
  });

  it("renders an issue in full, behind a lock marked signed-out only", async () => {
    const html = await render(IssuePage({ params: Promise.resolve({ slug: ISSUE_SLUG }) }));

    expect(html).toContain(SAMPLE_CONTENT.title);
    expect(html).toContain(LAST_QUICK_HIT.text);
    expect(html).toContain("data-article-lock-clip");
    expect(html).toContain("Keep reading for free");
    expect(html).toMatch(new RegExp(`<div[^>]*${SIGNED_OUT_ONLY}[^>]*>(?:(?!</section>).)*Keep reading for free`, "s"));
  });

  it("renders the not-found message for an unknown issue slug", async () => {
    repository.fetchNewsletterIssueApiResponseBySlug.mockResolvedValue(null);

    const html = await render(IssuePage({ params: Promise.resolve({ slug: "missing" }) }));

    expect(html).toContain("Newsletter not found");
  });

  it("does not render an empty archive when the issue list cannot be read", async () => {
    repository.fetchNewsletterListPage.mockRejectedValue(new Error("database down"));

    await expect(render(ArchivePage())).rejects.toThrow("database down");
    await expect(render(ArchivePageN({ params: Promise.resolve({ page: "2" }) }))).rejects.toThrow("database down");
  });

  it.each([
    ["privacy", PrivacyPage],
    ["terms", TermsPage],
    ["for-brands", ForBrandsPage],
  ])("renders /%s with the header Subscribe buttons marked signed-out only", async (_label, Page) => {
    const html = await render(Page());

    expect(html).toMatch(new RegExp(`<button[^>]*${SIGNED_OUT_ONLY}[^>]*>Subscribe<`));
  });
});

describe("archive paging in the path", () => {
  beforeEach(() => {
    repository.fetchNewsletterListPage.mockReset();
  });

  it("sends /archive/page/1 to /archive", async () => {
    await expect(render(ArchivePageN({ params: Promise.resolve({ page: "1" }) }))).rejects.toThrow(
      "NEXT_REDIRECT /archive",
    );
  });

  it.each(["abc", "0", "2abc", "-1", "1.5"])("answers not-found for /archive/page/%s", async (page) => {
    await expect(render(ArchivePageN({ params: Promise.resolve({ page }) }))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(repository.fetchNewsletterListPage).not.toHaveBeenCalled();
  });

  it("shows the last page for a page past the end", async () => {
    repository.fetchNewsletterListPage.mockImplementation(async (page: number) =>
      page === 3 ? pageOf(3, 3) : { ...pageOf(page, 3), data: [] },
    );

    const html = await render(ArchivePageN({ params: Promise.resolve({ page: "99" }) }));

    expect(repository.fetchNewsletterListPage).toHaveBeenLastCalledWith(3, 6);
    expect(html).toContain(SAMPLE_CONTENT.title);
    expect(html).toContain('href="/archive/page/2"');
  });
});

function pageOf(currentPage: number, totalPages: number) {
  return {
    data: listPage.data,
    pagination: {
      currentPage,
      totalPages,
      totalCount: totalPages * 6,
      limit: 6,
      hasNextPage: currentPage < totalPages,
      hasPreviousPage: currentPage > 1,
    },
  };
}
