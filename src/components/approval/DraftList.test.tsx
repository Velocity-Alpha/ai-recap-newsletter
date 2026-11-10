import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import DraftList from "@/src/components/approval/DraftList";
import type { DraftListEntry } from "@/src/pipeline/draft/draft-board";

function entry(data: Partial<DraftListEntry>): DraftListEntry {
  return {
    id: 40,
    version: 1,
    status: "ready",
    subject: null,
    failedStepLabel: null,
    sent: false,
    current: false,
    createdAt: "2026-05-21T14:00:00.000Z",
    ...data,
  };
}

function renderThree() {
  return renderToStaticMarkup(
    <DraftList
      date="2026-05-21"
      selectedId={41}
      drafts={[
        entry({ id: 42, version: 3, status: "failed", failedStepLabel: "making the image" }),
        entry({ id: 41, version: 2, status: "running" }),
        entry({ id: 40, version: 1, subject: "First Take", sent: true, current: true }),
      ]}
    />,
  );
}

describe("DraftList", () => {
  it("lists each draft with version, time, subject, status, and which was sent", () => {
    const html = renderThree();

    expect(html).toContain("v3");
    expect(html).toContain("Failed at making the image");
    expect(html).toContain("Running");
    expect(html).toContain("First Take");
    expect(html).toContain("10:00 AM");
    expect(html).toContain("Sent");
    expect(html).toContain("Current");
    expect(html).toContain('href="/approval/drafts?date=2026-05-21&amp;draft=42"');
    expect(html).toMatch(/aria-current="true"[^>]*href="\/approval\/drafts\?date=2026-05-21&amp;draft=41"|href="\/approval\/drafts\?date=2026-05-21&amp;draft=41"[^>]*aria-current="true"/);
  });

  it("links only to the draft view: no GHL link, no template id, and no outside link (#149)", () => {
    const html = renderThree();

    expect(html).not.toContain("GHL");
    expect(html).not.toContain("Open in");
    expect(html).not.toContain('target="_blank"');
    const links = html.match(/href="[^"]*"/g) ?? [];
    expect(links).toHaveLength(3);
    for (const link of links) expect(link).toMatch(/^href="\/approval\/drafts\?/);
  });

  it("does not say a draft came from another draft's image: New image changes the draft in place", () => {
    expect(renderThree()).not.toContain("New image");
  });

  it("says when there are no drafts yet", () => {
    expect(renderToStaticMarkup(<DraftList date="2026-05-21" selectedId={null} drafts={[]} />)).toContain("No drafts for this date yet.");
  });
});
