import { describe, expect, it } from "vitest";

import { parseNewsletterIssue } from "@/src/features/newsletter/parsers";
import { WRITTEN_ISSUE_SCHEMA, parseWrittenIssue, toIssueContentJson } from "@/src/pipeline/draft/content";
import { SAMPLE_CONTENT, SAMPLE_DRAFT, SAMPLE_ISSUE } from "@/src/pipeline/draft/draft.fixture";

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  minItems?: number;
  maxItems?: number;
};

function objectSchemas(schema: JsonSchema): JsonSchema[] {
  const own = schema.type === "object" ? [schema] : [];
  const children = [
    ...Object.values(schema.properties ?? {}),
    ...Object.values(schema.$defs ?? {}),
    ...(schema.items ? [schema.items] : []),
  ];
  return [...own, ...children.flatMap(objectSchemas)];
}

describe("WRITTEN_ISSUE_SCHEMA", () => {
  const schema = WRITTEN_ISSUE_SCHEMA as JsonSchema;

  it("meets OpenAI strict mode: every object lists all its keys as required and allows no others", () => {
    const objects = objectSchemas(schema);
    expect(objects.length).toBeGreaterThan(5);
    for (const object of objects) {
      expect(object.additionalProperties).toBe(false);
      expect([...(object.required ?? [])].sort()).toEqual(Object.keys(object.properties ?? {}).sort());
    }
  });

  it("drops title_emoji, adds excerpt, and keeps n8n's other top-level keys", () => {
    expect(Object.keys(schema.properties ?? {})).toEqual([
      "title",
      "excerpt",
      "overview",
      "headlines",
      "research_and_analysis",
      "tools",
      "quick_hits",
    ]);
  });

  it("asks for exactly 3 bullets per feature story and numeric story ids", () => {
    const feature = schema.$defs?.feature_item;
    expect(feature?.properties?.bullets).toMatchObject({ minItems: 3, maxItems: 3 });
    for (const name of ["feature_item", "link_list_item", "compact_list_item"]) {
      expect(schema.$defs?.[name]?.properties?.story_id?.type).toBe("integer");
    }
  });
});

describe("parseWrittenIssue", () => {
  it("reads the model's JSON text", () => {
    expect(parseWrittenIssue(JSON.stringify(SAMPLE_CONTENT))).toEqual(SAMPLE_CONTENT);
  });

  it("rejects text that is not JSON", () => {
    expect(() => parseWrittenIssue("not json")).toThrow("The writer's output is not valid JSON.");
  });

  it("names the first field that does not match the schema", () => {
    const broken = structuredClone(SAMPLE_CONTENT) as unknown as { headlines: Array<{ story_id: unknown }> };
    broken.headlines[1].story_id = "502";

    expect(() => parseWrittenIssue(JSON.stringify(broken))).toThrow(
      "The writer's output does not match the schema (headlines[1].story_id)."
    );
  });

  it("rejects output without an excerpt", () => {
    const withoutExcerpt: Partial<typeof SAMPLE_CONTENT> = structuredClone(SAMPLE_CONTENT);
    delete withoutExcerpt.excerpt;

    expect(() => parseWrittenIssue(JSON.stringify(withoutExcerpt))).toThrow("(excerpt)");
  });
});

describe("toIssueContentJson", () => {
  const contentJson = toIssueContentJson(SAMPLE_CONTENT, {
    issueId: SAMPLE_ISSUE.id,
    issueDate: SAMPLE_ISSUE.issueDate,
    featuredImageUrl: SAMPLE_DRAFT.featuredImageUrl,
  });

  it("has the same keys, in the same order, as the content_json publish detection writes", () => {
    expect(Object.keys(contentJson)).toEqual([
      "schemaVersion",
      "featured_image_url",
      "title",
      "date",
      "issue_id",
      "overview",
      "headlines",
      "research_and_analysis",
      "tools",
      "quick_hits",
    ]);
    expect(contentJson).toMatchObject({ schemaVersion: 2, issue_id: 301, date: "2027-01-04" });
  });

  it("is read by the website's v2 parser as a complete issue", () => {
    const issue = parseNewsletterIssue({
      id: SAMPLE_ISSUE.id,
      slug: "pretend-lab-teaches-models-to-plan",
      title: SAMPLE_CONTENT.title,
      excerpt: SAMPLE_CONTENT.excerpt,
      feature_image_url: SAMPLE_DRAFT.featuredImageUrl,
      issue_date: SAMPLE_ISSUE.issueDate,
      published_at: null,
      content_json: contentJson,
    });

    expect(issue.schemaVersion).toBe(2);
    if (issue.schemaVersion !== 2) return;
    expect(issue.title).toBe("Pretend Lab Teaches Models To Plan");
    expect(issue.description).toBe(SAMPLE_CONTENT.overview.summary);
    expect(issue.content.overview?.summary).toBe(SAMPLE_CONTENT.overview.summary);
    expect(issue.content.headlines.map((item) => item.storyId)).toEqual([501, 502]);
    expect(issue.content.researchAndAnalysis.map((item) => item.storyId)).toEqual([503, 504]);
    expect(issue.content.tools.map((item) => [item.storyId, item.url, item.linkText])).toEqual([
      [505, "https://tools.example.test/toolkit", "Test Toolkit 2.0"],
      [506, "https://tools.example.test/plugin", "Mock Editor Plugin"],
    ]);
    expect(issue.content.quickHits.map((item) => item.storyId)).toEqual([507, 508]);
    for (const item of [...issue.content.headlines, ...issue.content.researchAndAnalysis]) {
      expect(item.bullets).toHaveLength(3);
      expect(item.storyDetail).not.toBe("");
    }
    expect(issue.content.headlines[0].bullets?.[2]).toEqual({
      before: "",
      highlight: "Planner third highlight",
      after: "starts the line.",
    });
  });
});
