import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import Pagination from "@/src/components/Pagination";

function linkHref(html: string, label: string) {
  return html.match(new RegExp(`<a[^>]*href="([^"]*)"[^>]*>${label}</a>`))?.[1];
}

describe("archive pagination", () => {
  it("links to the previous and next archive pages by path", () => {
    const html = renderToStaticMarkup(<Pagination currentPage={3} totalPages={5} />);

    expect(linkHref(html, "Previous")).toBe("/archive/page/2");
    expect(linkHref(html, "Next")).toBe("/archive/page/4");
  });

  it("links to /archive for the first page", () => {
    const html = renderToStaticMarkup(<Pagination currentPage={2} totalPages={5} />);

    expect(linkHref(html, "Previous")).toBe("/archive");
  });

  it("submits the page-jump form to /archive with a page query value", () => {
    const html = renderToStaticMarkup(<Pagination currentPage={2} totalPages={5} />);

    expect(html).toMatch(/<form[^>]*action="\/archive"/);
    expect(html).toMatch(/<input[^>]*name="page"/);
  });
});
