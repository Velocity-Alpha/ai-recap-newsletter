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
  it("renders both Subscribe buttons with a pointer cursor, marked signed-out only", () => {
    const html = renderToStaticMarkup(<HeaderClient />);

    expect(html.match(/<button[^>]*data-signed-out-only[^>]*cursor-pointer[^>]*>Subscribe</g)).toHaveLength(2);
  });
});
