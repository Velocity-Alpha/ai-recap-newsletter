import { parseHTML } from "linkedom";
import { act, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Clicks on the real board (#150), rendered into a linkedom document. Each test commits and checks the body the
 * board posts, and what the server makes of it.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const { window, document } = parseHTML("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window, document, HTMLElement: window.HTMLElement, Node: window.Node, IS_REACT_ACT_ENVIRONMENT: true });
// React checks `"oninput" in document` once, at import. linkedom has no such property, so without it React ignores
// "input" events and text fields never fire onChange.
Object.assign(document, { oninput: null });

const { createRoot } = await import("react-dom/client");
const { default: ApprovalBoard } = await import("@/components/approval/ApprovalBoard");
const { normalizeFeedback, normalizeOutline, normalizeProposed } = await import("@/src/pipeline/draft/outline");
const { diffBoard } = await import("@/src/pipeline/feedback/board-diff");

type Props = ComponentProps<typeof ApprovalBoard>;

function story(id: number) {
  return { id, headline: `Synthetic headline ${id}`, summary: `Synthetic summary ${id}` };
}

function candidate(id: number) {
  return {
    ...story(id),
    guid: `guid-${id}`,
    day: "2099-01-04",
    story_details: null,
    category: "Industry",
    source: "example",
    url: `https://example.test/${id}`,
    importance_score: 3,
    paywall_detected: "no" as const,
    keyword_score: 1,
    combined_score: 4,
  };
}

const PROPS: Props = {
  dateKey: "2099-01-05",
  unsentDrafts: [],
  onToggleDraftReuse: () => undefined,
  outlineDateLabel: "Monday, January 5, 2099",
  referenceStories: [],
  candidateSections: [
    { key: "headlines", label: "Top Stories", max: 4, selected: [story(1), story(2)], fill_ins: [] },
    { key: "tools", label: "Tools", max: 4, selected: [story(3)], fill_ins: [] },
  ],
  candidateMap: Object.fromEntries([1, 2, 3, 4].map((id) => [String(id), candidate(id)])),
  proposedLeadId: 1,
  repeatsRemoved: [
    {
      story: { id: 4, headline: "Synthetic headline 4" },
      section: "tools",
      repeat_of: { id: 90, headline: "Synthetic earlier headline", date: "2098-12-30", kind: "published" },
    },
  ],
  reasonCodes: { exclude: ["repeat", "promo"], lead: ["bigger story", "more reach"], move: ["wrong section"] },
  publishStatus: null,
};

const fetchMock = vi.fn<typeof fetch>();
let container: HTMLElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, message: "ok" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div") as unknown as HTMLElement;
  document.body.appendChild(container as never);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(props: Partial<Props> = {}) {
  await act(async () => root.render(<ApprovalBoard {...PROPS} {...props} />));
}

function buttons(): HTMLElement[] {
  return [...container.querySelectorAll("button")] as unknown as HTMLElement[];
}

function button(name: string, index = 0): HTMLElement {
  const found = buttons().filter((entry) => (entry.getAttribute("aria-label") ?? entry.textContent?.trim()) === name);
  if (!found[index]) throw new Error(`No button "${name}" (#${index}). Buttons: ${buttons().map((entry) => entry.getAttribute("aria-label") ?? entry.textContent).join(" | ")}`);
  return found[index];
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new window.Event("click", { bubbles: true }) as unknown as Event);
  });
}

async function type(input: HTMLElement, value: string) {
  // Set the value past React's own tracker on the element, so React sees a change.
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  await act(async () => {
    if (setter) setter.call(input, value);
    else (input as HTMLInputElement).value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
  });
}

/** The row of a story on the board. */
function storyRow(id: number): HTMLElement {
  const rows = [...container.querySelectorAll("[draggable]")] as unknown as HTMLElement[];
  const row = rows.find((entry) => entry.textContent?.includes(`Synthetic headline ${id}`));
  if (!row) throw new Error(`No row for story ${id}`);
  return row;
}

function within(element: HTMLElement, name: string): HTMLElement {
  const found = ([...element.querySelectorAll("button")] as unknown as HTMLElement[]).find(
    (entry) => (entry.getAttribute("aria-label") ?? entry.textContent?.trim()) === name,
  );
  if (!found) throw new Error(`No button "${name}" in the row`);
  return found;
}

/** Header "Commit", then "Commit outline" in the summary. Returns the body the board posted. */
async function commit(): Promise<Record<string, unknown>> {
  await click(button("Commit"));
  await click(button("Commit outline"));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // Other parts of the board (the "No issue today" button) read their own routes.
  const commits = fetchMock.mock.calls.filter(([url]) => url === "/api/newsletters/commit");
  expect(commits).toHaveLength(1);
  return JSON.parse(String(commits[0][1]?.body)) as Record<string, unknown>;
}

/** What the server saves as board actions for the body. */
function boardActions(body: Record<string, unknown>) {
  const storedUrls = new Map([1, 2, 3, 4].map((id) => [id, `https://example.test/${id}`] as const));
  return diffBoard({
    proposed: normalizeProposed(body),
    outline: normalizeOutline(body, "2099-01-05"),
    storedUrls,
    feedback: normalizeFeedback(body),
  });
}

describe("ApprovalBoard board actions", () => {
  it("commits after one exclude click and the commit, and the exclude has no reason", async () => {
    await render();

    await click(within(storyRow(2), "Exclude from issue"));
    const body = await commit();

    expect(body.proposed).toEqual({
      sections: [
        { key: "headlines", story_ids: [1, 2] },
        { key: "tools", story_ids: [3] },
      ],
      lead_story_id: 1,
      repeats_removed: [4],
    });
    expect(body.excluded_stories).toEqual([expect.objectContaining({ id: 2, reason: "", reason_code: "" })]);
    expect(body.feedback).toEqual([]);
    expect(boardActions(body)).toEqual([
      expect.objectContaining({ action: "exclude", storyId: 2, fromSection: "headlines", fromPosition: 2, reasonCode: null, reasonText: null }),
    ]);
  });

  it("shows the exclude codes of the setting as chips: one tap selects, a second tap clears, the text field stays", async () => {
    await render();
    await click(within(storyRow(2), "Exclude from issue"));
    await click(within(storyRow(2), "Expand"));

    expect(within(storyRow(2), "promo")).toBeTruthy();
    expect(storyRow(2).querySelector('input[placeholder="Reason for exclusion…"]')).not.toBeNull();
    await click(within(storyRow(2), "promo"));
    expect(within(storyRow(2), "promo").getAttribute("aria-pressed")).toBe("true");
    await click(within(storyRow(2), "repeat"));
    await click(within(storyRow(2), "repeat"));
    expect(within(storyRow(2), "repeat").getAttribute("aria-pressed")).toBe("false");
    await click(within(storyRow(2), "promo"));
    await type(storyRow(2).querySelector('input[placeholder="Reason for exclusion…"]') as unknown as HTMLElement, "an ad");

    const body = await commit();

    expect(body.excluded_stories).toEqual([expect.objectContaining({ id: 2, reason: "an ad", reason_code: "promo" })]);
    expect(boardActions(body)[0]).toMatchObject({ action: "exclude", reasonCode: "promo", reasonText: "an ad" });
  });

  it("shows other chips when the setting changes, with no deploy", async () => {
    await render({ reasonCodes: { exclude: ["off topic"], lead: [], move: [] } });
    await click(within(storyRow(2), "Exclude from issue"));
    await click(within(storyRow(2), "Expand"));

    expect(within(storyRow(2), "off topic")).toBeTruthy();
    expect(() => within(storyRow(2), "promo")).toThrow();
  });

  it("asks why only while the lead is not the proposed lead, and sends the reason", async () => {
    await render();
    expect(container.textContent).not.toContain("Why this lead?");

    await click(within(storyRow(2), "Expand"));
    await click(within(storyRow(2), "Set as headline"));
    expect(storyRow(2).textContent).toContain("Why this lead?");
    await click(within(storyRow(2), "bigger story"));

    const body = await commit();

    expect(body.feedback).toEqual([{ story_id: 2, action: "lead", code: "bigger story", text: "" }]);
    expect(boardActions(body)).toEqual([expect.objectContaining({ action: "lead", storyId: 2, reasonCode: "bigger story", detail: { from: 1 } })]);
  });

  it("asks why a story moved, and keeps the proposed sections as they were", async () => {
    await render();
    expect(container.textContent).not.toContain("Why moved?");

    await click(within(storyRow(2), "Expand"));
    await click(within(storyRow(2), "Tools"));
    expect(storyRow(2).textContent).toContain("Why moved?");
    await type(storyRow(2).querySelector('input[placeholder="Why moved…"]') as unknown as HTMLElement, "it is a tool");

    const body = await commit();

    expect((body.proposed as { sections: unknown }).sections).toEqual([
      { key: "headlines", story_ids: [1, 2] },
      { key: "tools", story_ids: [3] },
    ]);
    expect(body.feedback).toEqual([{ story_id: 2, action: "move", code: "", text: "it is a tool" }]);
    expect(boardActions(body)).toEqual([
      expect.objectContaining({ action: "move", storyId: 2, fromSection: "headlines", toSection: "tools", toPosition: 2, reasonText: "it is a tool" }),
    ]);
  });

  it("sends a restored repeat in repeats_removed, so it is logged as restore_repeat", async () => {
    await render();

    // A restored repeat comes back as a fill-in; selecting it puts it in the issue.
    await click(button("Restore"));
    await click(within(storyRow(4), "Select"));
    const body = await commit();

    expect((body.proposed as { repeats_removed: number[] }).repeats_removed).toEqual([4]);
    expect(boardActions(body).map((row) => [row.action, row.storyId])).toEqual([["restore_repeat", 4]]);
  });
});
