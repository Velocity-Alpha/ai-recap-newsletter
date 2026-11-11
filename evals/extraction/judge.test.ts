import { describe, expect, it } from "vitest";

import { GRADE_RUBRIC, gradeInput } from "@/evals/extraction/judge";
import {
  buildExtractionPrompt,
  EXTRACTION_CATEGORY_RULES,
  EXTRACTION_FILTER_RULES,
  EXTRACTION_HEADLINE_RULES,
  EXTRACTION_IMPORTANCE_RUBRIC,
  EXTRACTION_STORY_DETAIL_RULES,
  EXTRACTION_URL_RULES,
} from "@/src/pipeline/ingest/extract";

describe("GRADE_RUBRIC", () => {
  const imported = [EXTRACTION_FILTER_RULES, EXTRACTION_STORY_DETAIL_RULES, EXTRACTION_HEADLINE_RULES];

  it("holds the prompt's own rules, as the app sends them", () => {
    const prompt = buildExtractionPrompt({ sourceDate: "2026-11-09", text: "" });
    for (const part of imported) {
      expect(GRADE_RUBRIC).toContain(part);
      expect(prompt).toContain(part);
    }
  });

  // Golden covers category, importance and url: the judge must not grade them, from a copy or otherwise.
  it("restates no rule of the prompt outside the imported parts", () => {
    let own = GRADE_RUBRIC;
    for (const part of imported) own = own.replace(part, "");
    for (const phrase of ["Presented By", "asterisk", "Title Case", "Tier 1", "first rule that matches", "Launches", "roundup), leave url"]) {
      expect(own).not.toContain(phrase);
    }
    for (const part of [EXTRACTION_CATEGORY_RULES, EXTRACTION_IMPORTANCE_RUBRIC, EXTRACTION_URL_RULES]) expect(GRADE_RUBRIC).not.toContain(part);
  });
});

describe("gradeInput", () => {
  it("numbers the golden stories and the extracted stories from 1, and lists the items to leave out", () => {
    const input = gradeInput({
      sourceDate: "2026-11-09",
      text: "Issue body",
      golden: {
        stories: [
          { label: "Acme ships a model", url: "https://acme.example/model", category: "Launches", importance: 3 },
          { label: "Tools list", url: "", category: "Tools", importance: 2, roundup: true },
        ],
        excluded: [{ label: "Course ad", reason: "sponsored" }],
      },
      stories: [{ category: "Launches", headline: "Acme Ships", summary: "s", story_detail: "d", published_at: "2026-11-09", url: "", importance_score: 3 }],
    });
    expect(input).toMatch(/"number": 2,\s+"label": "Tools list",\s+"url": "",\s+"roundup": true/);
    expect(input).toContain('"label": "Course ad"');
    expect(input).toContain("# Extracted stories (1)");
    // The judge matches by event; golden's category and importance are for scoring, not for it.
    expect(input.split("# Extracted stories")[0]).not.toContain('"importance"');
  });
});
