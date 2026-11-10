import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DraftList from "@/src/components/approval/DraftList";
import type { StagedVersionEntry } from "@/src/pipeline/draft/draft-board";

function entry(data: Partial<StagedVersionEntry>): StagedVersionEntry {
  return {
    id: 9,
    version: 1,
    title: "First Take",
    stagedAt: "2026-05-21T14:00:00.000Z",
    serviceName: "Pretend Mail",
    serviceUrl: "https://mail.example.test/emails/1",
    latest: false,
    sent: false,
    ...data,
  };
}

function renderThree() {
  return renderToStaticMarkup(
    <DraftList
      stagedVersions={[
        entry({ id: 11, version: 3, title: "Third Take", latest: true, serviceUrl: "https://mail.example.test/emails/3" }),
        entry({ id: 10, version: 2, title: "Second Take", sent: true, serviceUrl: null }),
        entry({}),
      ]}
    />,
  );
}

describe("DraftList", () => {
  it("lists each staged version with its number, time and title, newest first", () => {
    const html = renderThree();

    expect(html.indexOf("v3")).toBeLessThan(html.indexOf("v2"));
    expect(html.indexOf("v2")).toBeLessThan(html.indexOf("v1"));
    expect(html).toContain("Third Take");
    expect(html).toContain("Second Take");
    expect(html).toContain("First Take");
    expect(html).toContain("10:00 AM");
  });

  it("marks the newest one latest and the one that was sent", () => {
    const items = renderThree().split("<li").slice(1);

    expect(items[0]).toContain("Latest");
    expect(items[0]).not.toContain("Sent");
    expect(items[1]).toContain("Sent");
    expect(items[1]).not.toContain("Latest");
    expect(items[2]).not.toContain("Latest");
    expect(items[2]).not.toContain("Sent");
  });

  it("links to the email in the distribution service, by the service's name, only when there is a link", () => {
    const items = renderThree().split("<li").slice(1);

    expect(items[0]).toContain('href="https://mail.example.test/emails/3"');
    expect(items[0]).toContain("Open in Pretend Mail");
    expect(items[0]).toContain('rel="noopener noreferrer"');
    expect(items[1]).not.toContain("Open in");
    expect(items[1]).not.toContain("href=");
  });

  it("shows a version without a time", () => {
    const html = renderToStaticMarkup(<DraftList stagedVersions={[entry({ stagedAt: null, latest: true })]} />);

    expect(html).toContain("v1");
    expect(html).not.toContain("·");
  });

  it("says when nothing is staged yet", () => {
    expect(renderToStaticMarkup(<DraftList stagedVersions={[]} />)).toContain("Nothing is staged for this date yet.");
  });
});
