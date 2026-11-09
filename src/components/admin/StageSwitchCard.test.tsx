import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import StageSwitchCard from "@/src/components/admin/StageSwitchCard";
import type { StageSwitchView } from "@/src/features/admin/stage-switches";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const VIEW: StageSwitchView = {
  key: "draft.owner",
  stage: "Draft",
  description: "Writes the issue after you commit an outline.",
  current: "n8n",
  isSet: true,
  updatedAt: null,
  options: [
    { value: "n8n", label: "n8n", consequence: "n8n drafts the issue.", isCurrent: true },
    { value: "native", label: "Native", consequence: "This app drafts the issue.", isCurrent: false },
  ],
};

function render(view: StageSwitchView) {
  return renderToStaticMarkup(<StageSwitchCard view={view} updatedLabel="Never changed" />);
}

describe("StageSwitchCard", () => {
  it("offers every other option as an enabled button", () => {
    const html = render(VIEW);

    expect(html).toMatch(/<button[^>]*>Switch to Native<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
  });

  it("shows a disabled option's button as disabled, with its reason", () => {
    const html = render({
      ...VIEW,
      options: VIEW.options.map((option) =>
        option.value === "native" ? { ...option, disabledReason: "Not ready yet (#999)" } : option,
      ),
    });

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Switch to Native<\/button>/);
    expect(html).toContain("Not ready yet (#999)");
  });
});
