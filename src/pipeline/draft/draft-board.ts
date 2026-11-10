import { distributionServiceName } from "@/src/pipeline/distribution/service";
import {
  DRAFT_START_STEP,
  getDraftStatus,
  isStuckDraft,
  listDraftsForDate,
  type DraftListItem,
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
  /** The distribution service's name for the owner, e.g. "GHL". */
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

export interface DraftListEntry {
  id: number;
  version: number;
  status: DraftStatus;
  subject: string | null;
  failedStepLabel: string | null;
  /** A sent email carried this draft. */
  sent: boolean;
  /** The newest ready draft, which the issue holds. */
  current: boolean;
  createdAt: string;
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

export function toDraftListEntry(item: DraftListItem): DraftListEntry {
  return {
    id: item.id,
    version: item.version,
    status: item.status,
    subject: item.subject,
    failedStepLabel: item.status === "failed" ? draftStepLabel(item.failedStep) : null,
    sent: item.sent,
    current: item.current,
    createdAt: item.createdAt.toISOString(),
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

async function loadStagedSummary(issueId: number): Promise<StagedSummary | null> {
  const row = await prisma.stagedVersion.findFirst({
    where: { issueId: BigInt(issueId), status: "staged" },
    orderBy: { version: "desc" },
    select: { version: true, stagedAt: true, service: true, serviceUrl: true },
  });
  if (!row) return null;
  return { version: row.version, stagedAt: iso(row.stagedAt), serviceName: distributionServiceName(row.service), serviceUrl: row.serviceUrl };
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

/** Every draft for a date (YYYY-MM-DD), newest first. */
export async function listDraftsForBoard(date: string): Promise<DraftListEntry[]> {
  return (await listDraftsForDate(date)).map(toDraftListEntry);
}
