import { describe, expect, it } from "vitest";

import { cleanText } from "@/src/features/newsletter/curation.service";

describe("newsletter curation", () => {
  it("cleans markdown and URLs without injecting replacement placeholders", () => {
    expect(
      cleanText(
        "- **[OpenAI launches model](https://example.com)** read more at https://example.com"
      )
    ).toBe("OpenAI launches model");
  });
});
