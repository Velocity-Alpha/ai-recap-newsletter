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

describe("subscribe CTA visibility", () => {
  it("hides the hero subscribe button for signed-in readers", () => {
    const html = renderToStaticMarkup(
      <Hero
        initialTickerStories={[]}
        initialTickerStats={null}
        showSubscribeButton={false}
      />,
    );

    expect(html).not.toContain(">Subscribe Free<");
  });

  it("hides the recent preview subscribe CTA for signed-in readers", () => {
    const html = renderToStaticMarkup(
      <RecentNewslettersPreview newsletters={[]} showSubscribeButton={false} />,
    );

    expect(html).not.toContain(">Keep Me Updated<");
  });

  it("hides the archive empty-state subscribe CTA for signed-in readers", () => {
    const html = renderToStaticMarkup(
      <RecentNewsletters
        newsletters={[]}
        currentPage={1}
        totalPages={1}
        showSubscribeButton={false}
      />,
    );

    expect(html).not.toContain(">Get Notified<");
  });

  it("hides the footer subscribe link for signed-in readers", () => {
    const html = renderToStaticMarkup(<FooterClient showSubscribeLink={false} />);

    expect(html).not.toContain(">Subscribe<");
  });
});
