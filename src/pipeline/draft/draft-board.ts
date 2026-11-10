import { issueState, type IssueState } from "@/src/pipeline/distribution/issue-state";
import { readDateIssueFacts, type StagedVersionRow } from "@/src/pipeline/distribution/issue-state-store";
import { distributionServiceName } from "@/src/pipeline/distribution/service";
import {
  DRAFT_START_STEP,
  getDraftStatus,
  isStuckDraft,
  type DraftStatus,
  type DraftView,
} from "@/src/pipeline/draft/draft-store";
import { DRAFT_STEPS } from "@/src/pipeline/draft/produce-draft";
import { DRAFT_STEP_LABELS, type DraftJobStep } from "@/src/pipeline/draft/run-draft";
import { prisma } from "@/src/server/prisma";

/**
 * What the board's draft view shows (#79): the draft store's rows, with plain step labels, dates as text, and
 * whether "Retry", a title or image change, and "Stage for sending" are allowed. Server only; the board's
 * components import the types.
 */

export const DRAFT_JOB_STEPS: readonly DraftJobStep[] = ["load", ...DRAFT_STEPS, "save"];

export type DraftStepState = "done" | "current" | "failed" | "waiting";

export interface DraftStepView {
  key: DraftJobStep;
  label: string;
  state: DraftStepState;
}

export interface UnreadStory {
  id: number;
  headline: string;
  url: string | null;
}

/** The issue's newest staged version (GLOSSARY.md): what the owner sends from the distribution service. */
export interface StagedSummary {
  version: number;
  stagedAt: string | null;
  /** The distribution service's name for the owner. */
  serviceName: string;
  /** The staged email in the service, when the service gave a link. */
  serviceUrl: string | null;
}

export interface DraftBoardView {
  id: number;
  issueId: number;
  /** YYYY-MM-DD */
  issueDate: string | null;
  version: number;
  status: DraftStatus;
  subject: string | null;
  /** The running step, in plain words. */
  stepLabel: string | null;
  failedStep: string | null;
  failedStepLabel: string | null;
  error: string | null;
  steps: DraftStepView[];
  hasHtml: boolean;
  /** Feature stories whose article the writer could not read ("source not read"). */
  unreadStories: UnreadStory[];
  /** Failed, or stuck in running (or never started): the same rule as `retryDraft`. */
  retryable: boolean;
  /**
   * The current draft (#149): ready, the issue's newest draft, and the issue is not published. Only it can get a
   * new title or image, or be staged for sending.
   */
  editable: boolean;
  /** Why a ready draft is not `editable`. */
  issuePublished: boolean;
  hasNewerDraft: boolean;
  featuredImageUrl: string | null;
  scenePrompt: string | null;
  /** When the owner last changed the title or the image. The preview loads again when it changes. */
  editedAt: string | null;
  /** Null when nothing is staged for the issue. */
  staged: StagedSummary | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** One staged version in the draft page's list. */
export interface StagedVersionEntry extends StagedSummary {
  id: number;
  title: string;
  /** The newest staged version: the one to send. */
  latest: boolean;
  /** A sent email carried this version. */
  sent: boolean;
}

/** What the board and the draft page show for a date. */
export interface DateDraftsView {
  state: IssueState;
  /** The issue's newest draft row. `edited`: the owner changed its title or image. */
  currentDraft: { id: number; edited: boolean } | null;
  /** Newest first. */
  stagedVersions: StagedVersionEntry[];
}

const START_LABEL = "starting the draft job";

export function draftStepLabel(step: string | null): string | null {
  if (!step) return null;
  if (step === DRAFT_START_STEP) return START_LABEL;
  return DRAFT_STEP_LABELS[step as DraftJobStep] ?? step;
}

export function draftSteps(view: Pick<DraftView, "status" | "currentStep" | "failedStep">): DraftStepView[] {
  const plan = DRAFT_JOB_STEPS;
  const marker = view.status === "failed" ? view.failedStep : view.currentStep;
  const at = marker ? plan.indexOf(marker as DraftJobStep) : -1;
  return plan.map((key, index) => {
    let state: DraftStepState = "waiting";
    if (view.status === "ready" || (at >= 0 && index < at)) state = "done";
    else if (index === at) state = view.status === "failed" ? "failed" : "current";
    return { key, label: DRAFT_STEP_LABELS[key], state };
  });
}

function isRetryable(view: DraftView, now: Date): boolean {
  return view.status === "failed" || isStuckDraft(view, now);
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toDraftBoardView(
  view: DraftView,
  options: { now: Date; unreadStories?: UnreadStory[]; staged?: StagedSummary | null },
): DraftBoardView {
  return {
    id: view.id,
    issueId: view.issueId,
    issueDate: view.issueDate,
    version: view.version,
    status: view.status,
    subject: view.subject,
    stepLabel: view.status === "running" ? draftStepLabel(view.currentStep) : null,
    failedStep: view.failedStep,
    failedStepLabel: draftStepLabel(view.failedStep),
    error: view.error,
    steps: draftSteps(view),
    hasHtml: view.hasHtml,
    unreadStories: options.unreadStories ?? [],
    retryable: isRetryable(view, options.now),
    editable: view.status === "ready" && !view.issuePublished && !view.hasNewerDraft,
    issuePublished: view.issuePublished,
    hasNewerDraft: view.hasNewerDraft,
    featuredImageUrl: view.featuredImageUrl,
    scenePrompt: view.scenePrompt,
    editedAt: iso(view.editedAt),
    staged: options.staged ?? null,
    createdAt: view.createdAt.toISOString(),
    startedAt: iso(view.startedAt),
    finishedAt: iso(view.finishedAt),
  };
}

async function loadUnreadStories(ids: number[]): Promise<UnreadStory[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.story.findMany({ where: { id: { in: ids } }, select: { id: true, headline: true, url: true } });
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  return ids.map((id) => {
    const row = byId.get(id);
    return { id, headline: row?.headline?.trim() || `Story ${id}`, url: row?.url ?? null };
  });
}

function toStagedSummary(row: Pick<StagedVersionRow, "version" | "stagedAt" | "service" | "serviceUrl">): StagedSummary {
  return { version: row.version, stagedAt: iso(row.stagedAt), serviceName: distributionServiceName(row.service), serviceUrl: row.serviceUrl };
}

async function loadStagedSummary(issueId: number): Promise<StagedSummary | null> {
  const row = await prisma.stagedVersion.findFirst({
    where: { issueId: BigInt(issueId), status: "staged" },
    orderBy: { version: "desc" },
    select: { version: true, stagedAt: true, service: true, serviceUrl: true },
  });
  return row && toStagedSummary(row);
}

/**
 * The ids of the staged versions a sent email carried. An email staged before #149 names only its draft: it
 * counts for that draft's newest staged version, as in publish detection.
 */
async function loadSentVersionIds(issueIds: number[], versions: StagedVersionRow[]): Promise<Set<number>> {
  if (versions.length === 0) return new Set();
  const events = await prisma.publishEvent.findMany({
    where: { issueId: { in: issueIds.map((id) => BigInt(id)) } },
    select: { stagedVersionId: true, draftId: true },
  });
  const sent = new Set<number>();
  for (const event of events) {
    if (event.stagedVersionId !== null) sent.add(Number(event.stagedVersionId));
    else if (event.draftId !== null) {
      // `versions` is newest first.
      const ofDraft = versions.find((version) => version.draftId === Number(event.draftId));
      if (ofDraft) sent.add(ofDraft.id);
    }
  }
  return sent;
}

/** One draft for the board's live view. Null when there is no such draft. */
export async function readDraftForBoard(draftId: number, now: Date): Promise<DraftBoardView | null> {
  const view = await getDraftStatus(draftId);
  if (!view) return null;
  return toDraftBoardView(view, {
    now,
    unreadStories: await loadUnreadStories(view.unreadStoryIds),
    staged: await loadStagedSummary(view.issueId),
  });
}

/** The date's state, current draft, and staged versions. `date` is YYYY-MM-DD. */
export async function readDateForBoard(date: string): Promise<DateDraftsView> {
  const facts = await readDateIssueFacts(date);
  const sent = await loadSentVersionIds(facts.issueIds, facts.stagedVersions);
  return {
    state: issueState(facts),
    currentDraft: facts.newestDraft && { id: facts.newestDraft.id, edited: facts.newestDraft.editedAt !== null },
    stagedVersions: facts.stagedVersions.map((row, index) => ({
      ...toStagedSummary(row),
      id: row.id,
      title: row.title,
      latest: index === 0,
      sent: sent.has(row.id),
    })),
  };
}
