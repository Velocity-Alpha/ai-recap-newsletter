import type { SectionKey } from "@/src/features/newsletter/section-config";
import {
  createDraftArticleReader,
  prismaArticleStore,
  readerOptionsFromEnv,
  type ArticleReadReport,
} from "@/src/pipeline/draft/articles";
import {
  FEATURE_SECTIONS,
  type ApprovedSections,
  type ApprovedStory,
  type WrittenIssueContent,
} from "@/src/pipeline/draft/content";
import { renderIssueEmailHtml } from "@/src/pipeline/draft/email-html";
import {
  createDraftTemplate,
  GhlTemplateError,
  type DraftTemplateInput,
  type DraftTemplateResult,
} from "@/src/pipeline/draft/ghl-template";
import {
  makeFeaturedImage,
  type FeaturedImage,
  type FeaturedImageInput,
} from "@/src/pipeline/draft/image/featured-image";
import type { ApprovalOutline } from "@/src/pipeline/draft/outline";
import { assertValidContent } from "@/src/pipeline/draft/validate";
import {
  createOpenAIIssueWriter,
  unreadArticleStoryIds,
  type ArticleText,
  type IssueWriter,
} from "@/src/pipeline/draft/writer";
import type { SideEffectRecord } from "@/src/pipeline/side-effects";

/**
 * Turns a committed outline into a draft's content, email HTML, featured image, and GHL template. No database:
 * the draft job (run-draft.ts) loads the inputs and saves the result, and the replay script calls this directly.
 */

export const DRAFT_STEPS = ["read_articles", "write", "validate", "image", "html", "ghl"] as const;
export type DraftStep = (typeof DRAFT_STEPS)[number];

export interface ProduceDraftInput {
  outline: ApprovalOutline;
  /** The approved stories by section, with the board's link and note edits applied (approved-stories.ts). */
  stories: ApprovedSections;
  issue: { id: number; /** YYYY-MM-DD */ date: string };
  draft: { id: number; version: number };
}

/** Reads the articles of feature-section stories. */
export type ReadArticles = (stories: ApprovedStory[]) => Promise<ArticleText[]>;
export type MakeImage = (input: FeaturedImageInput) => Promise<FeaturedImage>;
export type CreateTemplate = (input: DraftTemplateInput) => Promise<DraftTemplateResult>;

export interface ProduceDraftDeps {
  /** `createDraftDeps` gives the article reader (#120); `readNoArticles` skips reading. */
  readArticles: ReadArticles;
  writer: IssueWriter;
  makeImage: MakeImage;
  createTemplate: CreateTemplate;
  /** Called as each step starts. */
  onStep?: (step: DraftStep) => void | Promise<void>;
  /** Milliseconds clock for step timings. */
  now?: () => number;
}

export interface ProducedDraft {
  content: WrittenIssueContent;
  html: string;
  featuredImageUrl: string;
  scenePrompt: string;
  ghlTemplateId: string;
  ghlPreviewUrl: string | null;
  /** `recorded` outside production: nothing reached GHL. */
  ghlMode: DraftTemplateResult["mode"];
  /** Feature-section stories whose article was not read. The board marks them "source not read". */
  unreadStoryIds: number[];
  stepMs: Partial<Record<DraftStep, number>>;
}

/** What a failed draft had made before the failing step. */
export type PartialDraft = Partial<
  Pick<ProducedDraft, "content" | "unreadStoryIds" | "featuredImageUrl" | "scenePrompt" | "html" | "ghlTemplateId" | "ghlPreviewUrl">
>;

/** A failed step. The message is the cause's own message, for the board and the incident. */
export class DraftStepError extends Error {
  constructor(
    readonly step: DraftStep,
    cause: unknown,
    readonly partial: PartialDraft,
    readonly stepMs: Partial<Record<DraftStep, number>>,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "DraftStepError";
  }
}

/**
 * Reads no article: the writer works from the summaries and every feature-section story is saved as "source not
 * read". For tests, and the replay script's `--no-read`.
 */
export const readNoArticles: ReadArticles = async (stories) => stories.map((story) => ({ storyId: story.id, unread: true }));

function featureStories(sections: ApprovedSections): ApprovedStory[] {
  return (FEATURE_SECTIONS as readonly SectionKey[]).flatMap((key) => sections[key]);
}

export async function produceDraft(input: ProduceDraftInput, deps: ProduceDraftDeps): Promise<ProducedDraft> {
  const now = deps.now ?? (() => Date.now());
  const readArticles = deps.readArticles;
  const partial: PartialDraft = {};
  const stepMs: Partial<Record<DraftStep, number>> = {};

  async function step<T>(name: DraftStep, run: () => Promise<T> | T): Promise<T> {
    const started = now();
    try {
      await deps.onStep?.(name);
      return await run();
    } catch (error) {
      throw new DraftStepError(name, error, { ...partial }, { ...stepMs, [name]: now() - started });
    } finally {
      stepMs[name] = now() - started;
    }
  }

  const { stories: sections, issue, draft } = input;

  const articles = await step("read_articles", () => readArticles(featureStories(sections)));
  partial.unreadStoryIds = unreadArticleStoryIds(sections, articles);

  const content = await step("write", () => deps.writer({ sections, leadStoryId: input.outline.leadStoryId, articles }));
  partial.content = content;

  await step("validate", () => assertValidContent(content, sections));

  const image = await step("image", () =>
    deps.makeImage({
      issueDate: issue.date,
      context: {
        subjectLine: content.title,
        topStories: content.headlines.map((story) => ({ headline: story.headline, detail: story.story_detail })),
      },
    }),
  );
  partial.featuredImageUrl = image.imageUrl;
  partial.scenePrompt = image.scenePrompt;

  const html = await step("html", () =>
    renderIssueEmailHtml(content, { id: issue.id, issueDate: issue.date }, { id: draft.id, featuredImageUrl: image.imageUrl }),
  );
  partial.html = html;

  const template = await step("ghl", async () => {
    try {
      return await deps.createTemplate({ issueDate: issue.date, version: draft.version, subject: content.title, html });
    } catch (error) {
      // GHL made the template but setting its HTML failed: keep the id, so the owner can find it.
      if (error instanceof GhlTemplateError && error.templateId) partial.ghlTemplateId = error.templateId;
      throw error;
    }
  });

  return {
    content,
    html,
    featuredImageUrl: image.imageUrl,
    scenePrompt: image.scenePrompt,
    ghlTemplateId: template.templateId,
    ghlPreviewUrl: template.previewUrl ?? null,
    ghlMode: template.mode,
    unreadStoryIds: partial.unreadStoryIds,
    stepMs,
  };
}

export interface DraftDepsOptions {
  /** Gets each GHL call outside production. */
  record?: (entry: SideEffectRecord) => void | Promise<void>;
  /** Gets every feature-section story's read outcome, for the run log. */
  onArticleReads?: (reads: ArticleReadReport[]) => void | Promise<void>;
  /** Gets saved-copy problems, which never fail the step. */
  onArticleWarning?: (message: string) => void | Promise<void>;
}

/** The real services. GHL only sends in production; elsewhere `record` gets each call. */
export function createDraftDeps(
  env: Record<string, string | undefined> = process.env,
  options: DraftDepsOptions = {},
): Omit<ProduceDraftDeps, "onStep" | "now"> {
  return {
    // Reuses each story's saved copy, reads the rest (#115 order, 60 s deadline), and saves what it read (#120).
    readArticles: createDraftArticleReader({
      store: prismaArticleStore,
      readOptions: readerOptionsFromEnv(env),
      onReads: options.onArticleReads,
      onWarning: options.onArticleWarning,
    }),
    // Built per call, so a missing OPENAI_API_KEY fails the write step with a plain message.
    writer: (input) => createOpenAIIssueWriter({ apiKey: env.OPENAI_API_KEY })(input),
    makeImage: (input) =>
      makeFeaturedImage(input, {
        appEnv: env.APP_ENV,
        scene: { apiKey: env.OPENAI_API_KEY },
        image: { apiKey: env.VERTEX_API_KEY },
      }),
    createTemplate: (input) => createDraftTemplate(input, { env, record: options.record }),
  };
}
