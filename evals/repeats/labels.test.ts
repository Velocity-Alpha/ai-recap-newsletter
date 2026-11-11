import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { labelRulesList } from "@/evals/repeats/labels";
import { FIXTURES } from "@/evals/repeats/pairs";

describe("PAIR_LABEL_RULES", () => {
  it("is word for word the labelling rules of the fixture's README", () => {
    const readme = readFileSync(join(FIXTURES, "README.md"), "utf8");
    const section = readme.slice(readme.indexOf("## Labelling rules"), readme.indexOf("## Results"));
    const oneLine = (text: string) => text.replace(/\n {2}/g, " ").trim();
    expect(oneLine(section.replace("## Labelling rules", ""))).toBe(labelRulesList());
  });
});
