import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => {
    const { priority, alt, ...imageProps } = props;
    void priority;

    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={alt ?? ""} {...imageProps} />;
  },
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/src/components/NewsTicker", () => ({
  default: () => <div>NewsTicker</div>,
}));

vi.mock("lucide-react", () => ({
  Newspaper: () => <svg />,
  Send: () => <svg />,
}));

import FooterClient from "@/src/components/FooterClient";
import Hero from "@/src/components/Hero";
import RecentNewsletters from "@/src/components/RecentNewsletters";
import RecentNewslettersPreview from "@/src/components/RecentNewslettersPreview";

describe("subscribe CTAs are marked signed-out only", () => {
  it("marks the hero subscribe button", () => {
    const html = renderToStaticMarkup(<Hero initialTickerStories={[]} initialTickerStats={null} />);

    expect(html).toMatch(/<button[^>]*data-signed-out-only[^>]*>Subscribe Free</);
  });

  it("marks the recent preview subscribe CTA", () => {
    const html = renderToStaticMarkup(<RecentNewslettersPreview newsletters={[]} />);

    expect(html).toMatch(/<a[^>]*data-signed-out-only[^>]*>Keep Me Updated</);
  });

  it("marks the archive empty-state subscribe CTA", () => {
    const html = renderToStaticMarkup(<RecentNewsletters newsletters={[]} currentPage={1} totalPages={1} />);

    expect(html).toMatch(/<a[^>]*data-signed-out-only[^>]*>(?:<svg><\/svg>)?Get Notified</);
  });

  it("marks the footer subscribe link", () => {
    const html = renderToStaticMarkup(<FooterClient />);

    expect(html).toMatch(/<li data-signed-out-only=""><a href="\/#subscribe"[^>]*>Subscribe</);
  });
});
