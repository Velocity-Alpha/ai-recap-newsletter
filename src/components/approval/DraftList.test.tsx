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
    ghlTemplateId: null,
    ghlPreviewUrl: null,
    sent: false,
    current: false,
    createdAt: "2026-05-21T14:00:00.000Z",
    ...data,
  };
}

describe("DraftList", () => {
  it("lists each draft with version, time, subject, status, GHL link, and which was sent", () => {
    const html = renderToStaticMarkup(
      <DraftList
        date="2026-05-21"
        selectedId={41}
        drafts={[
          entry({ id: 42, version: 3, status: "failed", failedStepLabel: "making the image" }),
          entry({ id: 41, version: 2, status: "running" }),
          entry({ id: 40, version: 1, subject: "First Take", ghlPreviewUrl: "https://preview.example.test/1", sent: true, current: true }),
        ]}
      />,
    );

    expect(html).toContain("v3");
    expect(html).toContain("Failed at making the image");
    expect(html).toContain("Running");
    expect(html).toContain("First Take");
    expect(html).toContain("10:00 AM");
    expect(html).toContain("Sent");
    expect(html).toContain("Current");
    expect(html).toContain('href="https://preview.example.test/1"');
    expect(html).toContain('href="/approval/drafts?date=2026-05-21&amp;draft=42"');
    expect(html).toMatch(/aria-current="true"[^>]*href="\/approval\/drafts\?date=2026-05-21&amp;draft=41"|href="\/approval\/drafts\?date=2026-05-21&amp;draft=41"[^>]*aria-current="true"/);
  });

  it("says when there are no drafts yet", () => {
    expect(renderToStaticMarkup(<DraftList date="2026-05-21" selectedId={null} drafts={[]} />)).toContain("No drafts for this date yet.");
  });
});
