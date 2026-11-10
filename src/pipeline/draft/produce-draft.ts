import type { SectionKey } from "@/src/features/newsletter/section-config";
import {
  createDraftArticleReader,
  prismaArticleStore,
  readerOptionsFromEnv,
  type ArticleReadReport,
  type ReadContext,
} from "@/src/pipeline/draft/articles";
import {
  FEATURE_SECTIONS,
  type ApprovedSections,
  type ApprovedStory,
  type WrittenIssueContent,
} from "@/src/pipeline/draft/content";
import { renderIssueEmailHtml } from "@/src/pipeline/draft/email-html";
import { makeFeaturedImage, type FeaturedImage, type FeaturedImageInput } from "@/src/pipeline/draft/image/featured-image";
import type { ApprovalOutline } from "@/src/pipeline/draft/outline";
import { assertValidContent, findContentProblems } from "@/src/pipeline/draft/validate";
import {
  createOpenAIIssueWriter,
  unreadArticleStoryIds,
  type ArticleText,
  type IssueWriter,
  type WriterInput,
} from "@/src/pipeline/draft/writer";

/**
 * Turns a committed outline into a draft's content, featured image, and email HTML. No database, and no call to
 * the distribution service: only "Stage for sending" creates an email there (ADR 0004). The draft job
 * (run-draft.ts) loads the inputs and saves the result, and the replay script calls this directly.
 */

export const DRAFT_STEPS = ["read_articles", "write", "validate", "image", "html"] as const;
export type DraftStep = (typeof DRAFT_STEPS)[number];

export interface ProduceDraftInput {
  issue: { id: number; /** YYYY-MM-DD */ date: string };
  draft: { id: number };
  outline: ApprovalOutline;
  /** The approved stories by section, with the board's link and note edits applied (approved-stories.ts). */
  stories: ApprovedSections;
}

/** Reads the articles of feature-section stories, for the issue being drafted. */
export type ReadArticles = (stories: ApprovedStory[], context?: ReadContext) => Promise<ArticleText[]>;
export type MakeImage = (input: FeaturedImageInput) => Promise<FeaturedImage>;

export interface ProduceDraftDeps {
  /** `createDraftDeps` gives the article reader (#120); `readNoArticles` skips reading. */
  readArticles: ReadArticles;
  writer: IssueWriter;
  makeImage: MakeImage;
  /** Called as each step starts. A rewrite runs `write` and `validate` a second time. */
  onStep?: (step: DraftStep) => void | Promise<void>;
  /** Called as the rewrite starts, with how many problems the first draft had. */
  onRewrite?: (problemCount: number) => void | Promise<void>;
  /** Milliseconds clock for step timings. */
  now?: () => number;
  /** Once aborted, the running step fails with the signal's reason (the job's deadline). */
  signal?: AbortSignal;
}

export interface ProducedDraft {
  content: WrittenIssueContent;
  html: string;
  featuredImageUrl: string;
  scenePrompt: string;
  /** Feature-section stories whose article was not read. The board marks them "source not read". */
  unreadStoryIds: number[];
  stepMs: Partial<Record<DraftStep, number>>;
}

/** What a failed draft had made before the failing step. */
export type PartialDraft = Partial<Pick<ProducedDraft, "content" | "unreadStoryIds" | "featuredImageUrl" | "scenePrompt" | "html">>;

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

/**
 * The work's result, or the signal's reason as soon as it aborts. The services take no signal, so the work itself
 * keeps going in the background; the caller just stops waiting for it.
 */
export function untilAborted<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function featureStories(sections: ApprovedSections): ApprovedStory[] {
  return (FEATURE_SECTIONS as readonly SectionKey[]).flatMap((key) => sections[key]);
}

/** What the scene prompt and the scene ideas are based on: the subject line and the top stories. */
export function imageContextFor(content: WrittenIssueContent): FeaturedImageInput["context"] {
  return {
    subjectLine: content.title,
    topStories: content.headlines.map((story) => ({ headline: story.headline, detail: story.story_detail })),
  };
}

export async function produceDraft(input: ProduceDraftInput, deps: ProduceDraftDeps): Promise<ProducedDraft> {
  const now = deps.now ?? (() => Date.now());
  const readArticles = deps.readArticles;
  const partial: PartialDraft = {};
  const stepMs: Partial<Record<DraftStep, number>> = {};

  async function step<T>(name: DraftStep, run: () => Promise<T> | T): Promise<T> {
    const started = now();
    // A step that runs twice (the rewrite) reports its total time.
    const elapsed = () => (stepMs[name] ?? 0) + now() - started;
    try {
      deps.signal?.throwIfAborted();
      await deps.onStep?.(name);
      return await untilAborted(Promise.resolve().then(run), deps.signal);
    } catch (error) {
      throw new DraftStepError(name, error, { ...partial }, { ...stepMs, [name]: elapsed() });
    } finally {
      stepMs[name] = elapsed();
    }
  }

  const { issue, draft, stories: sections } = input;

  const articles = await step("read_articles", () => readArticles(featureStories(sections), { issueId: issue.id }));
  const unreadStoryIds = unreadArticleStoryIds(sections, articles);
  partial.unreadStoryIds = unreadStoryIds;

  const writerInput: WriterInput = { sections, leadStoryId: input.outline.leadStoryId, articles };
  let content = await step("write", () => deps.writer(writerInput));
  partial.content = content;

  const problems = await step("validate", () => findContentProblems(content, sections));
  if (problems.length > 0) {
    // The writer varies from run to run, so one rewrite with the problems listed often fixes a miss.
    const previous = content;
    content = await step("write", async () => {
      await deps.onRewrite?.(problems.length);
      return deps.writer({ ...writerInput, revision: { previous, problems } });
    });
    partial.content = content;
    await step("validate", () => assertValidContent(content, sections));
  }

  const image = await step("image", () => deps.makeImage({ issueDate: issue.date, context: imageContextFor(content) }));
  partial.featuredImageUrl = image.imageUrl;
  partial.scenePrompt = image.scenePrompt;

  const html = await step("html", () =>
    renderIssueEmailHtml(content, { id: issue.id, issueDate: issue.date }, { id: draft.id, featuredImageUrl: image.imageUrl }),
  );
  partial.html = html;

  return { content, html, featuredImageUrl: image.imageUrl, scenePrompt: image.scenePrompt, unreadStoryIds, stepMs };
}

export interface DraftDepsOptions {
  /** Gets every feature-section story's read outcome, for the run log. */
  onArticleReads?: (reads: ArticleReadReport[]) => void | Promise<void>;
  /** Gets saved-copy problems, which never fail the step. */
  onArticleWarning?: (message: string) => void | Promise<void>;
  /** Gets other read-step news, such as old saved text cleared. */
  onArticleInfo?: (message: string) => void | Promise<void>;
}

/** The real services: the article reader, the writer, and the image maker. */
export function createDraftDeps(
  env: Record<string, string | undefined> = process.env,
  options: DraftDepsOptions = {},
): Omit<ProduceDraftDeps, "onStep" | "now" | "signal"> {
  return {
    // Clears old saved text, reuses each story's saved copy, reads the rest (#115 order, 60 s deadline), and saves
    // what it read (#120).
    readArticles: createDraftArticleReader({
      store: prismaArticleStore,
      readOptions: readerOptionsFromEnv(env),
      onReads: options.onArticleReads,
      onWarning: options.onArticleWarning,
      onInfo: options.onArticleInfo,
    }),
    // Built per call, so a missing OPENAI_API_KEY fails the write step with a plain message.
    writer: (input) => createOpenAIIssueWriter({ apiKey: env.OPENAI_API_KEY })(input),
    makeImage: (input) =>
      makeFeaturedImage(input, {
        appEnv: env.APP_ENV,
        scene: { apiKey: env.OPENAI_API_KEY },
        image: { apiKey: env.VERTEX_API_KEY },
      }),
  };
}
