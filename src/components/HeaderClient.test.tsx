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

import HeaderClient from "@/src/components/HeaderClient";

describe("HeaderClient", () => {
  it("hides subscribe buttons for signed-in readers", () => {
    const html = renderToStaticMarkup(<HeaderClient showSubscribeButton={false} />);

    expect(html).not.toContain(">Subscribe<");
  });

  it("renders subscribe buttons with a pointer cursor when shown", () => {
    const html = renderToStaticMarkup(<HeaderClient showSubscribeButton />);

    expect(html.match(/>Subscribe</g)).toHaveLength(2);
    expect(html).toContain("cursor-pointer");
  });
});
