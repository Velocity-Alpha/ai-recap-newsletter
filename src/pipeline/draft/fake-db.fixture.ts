/**
 * Test helper: a small in-memory stand-in for the Prisma client, covering the tables and calls the draft job
 * uses. `$transaction` rolls back on error, and `(issueId, version)` is unique on drafts, like the real tables.
 */
import { Prisma } from "@/src/generated/prisma";

type Row = Record<string, unknown> & { id: bigint };
type Where = Record<string, unknown>;
type OrderBy = Record<string, "asc" | "desc"> | Array<Record<string, "asc" | "desc">>;

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a === "bigint" || typeof b === "bigint") return a !== null && b !== null && a !== undefined && b !== undefined && String(a) === String(b);
  return a === b;
}

function matches(row: Row, where: Where = {}): boolean {
  return Object.entries(where).every(([key, condition]) => {
    const value = row[key];
    if (condition === null) return value === null || value === undefined;
    if (condition instanceof Date || typeof condition !== "object") return same(value, condition);
    const range = condition as { in?: unknown[]; gt?: never; lt?: never; not?: unknown };
    if (range.in && !range.in.some((item) => same(item, value))) return false;
    if (range.gt !== undefined && !((value as never) > range.gt)) return false;
    if (range.lt !== undefined && !((value as never) < range.lt)) return false;
    if ("not" in range && (range.not === null ? value === null || value === undefined : same(value, range.not))) return false;
    return true;
  });
}

function sorted(rows: Row[], orderBy?: OrderBy): Row[] {
  const keys = orderBy ? (Array.isArray(orderBy) ? orderBy : [orderBy]) : [];
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const [field, direction] = Object.entries(key)[0];
      const left = a[field] as never;
      const right = b[field] as never;
      if (left === right) continue;
      return (left < right ? -1 : 1) * (direction === "desc" ? -1 : 1);
    }
    return 0;
  });
}

function pick(row: Row | undefined, select?: Record<string, boolean>) {
  if (!row) return null;
  const copy = structuredClone(row);
  return select ? Object.fromEntries(Object.keys(select).map((key) => [key, copy[key]])) : copy;
}

function stored(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value === Prisma.DbNull ? null : value]));
}

export interface FakeTable {
  rows: Row[];
  /** Every `data` passed to update/updateMany, in order. */
  updates: Array<Record<string, unknown>>;
}

function table(
  state: FakeTable,
  options: { defaults: () => Record<string, unknown>; unique?: string[]; nextId: () => bigint; failUpdate?: () => Error | null },
) {
  const assertUnique = (row: Row) => {
    const keys = options.unique;
    if (keys && state.rows.some((other) => other !== row && keys.every((key) => same(other[key], row[key])))) {
      throw Object.assign(new Error(`Unique constraint failed on (${keys.join(", ")})`), { code: "P2002" });
    }
  };
  const update = (row: Row, data: Record<string, unknown>) => {
    const failure = options.failUpdate?.();
    if (failure) throw failure;
    state.updates.push(structuredClone(stored(data)));
    Object.assign(row, stored(data));
  };
  return {
    findUnique: async ({ where, select }: { where: Where; select?: Record<string, boolean> }) =>
      pick(state.rows.find((row) => matches(row, where)), select),
    findFirst: async ({ where, orderBy, select }: { where?: Where; orderBy?: OrderBy; select?: Record<string, boolean> }) =>
      pick(sorted(state.rows.filter((row) => matches(row, where)), orderBy)[0], select),
    findMany: async ({ where, orderBy, select }: { where?: Where; orderBy?: OrderBy; select?: Record<string, boolean> } = {}) =>
      sorted(state.rows.filter((row) => matches(row, where)), orderBy).map((row) => pick(row, select)),
    count: async ({ where }: { where?: Where } = {}) => state.rows.filter((row) => matches(row, where)).length,
    create: async ({ data, select }: { data: Record<string, unknown>; select?: Record<string, boolean> }) => {
      const row = { ...options.defaults(), ...stored(data), id: (data.id as bigint | undefined) ?? options.nextId() } as Row;
      assertUnique(row);
      state.rows.push(row);
      return pick(row, select);
    },
    /** Every `data` passed to createMany, as given (to check which columns an insert names). */
    createManyCalls: [] as Array<Array<Record<string, unknown>>>,
    async createMany({ data }: { data: Array<Record<string, unknown>>; skipDuplicates?: boolean }) {
      this.createManyCalls.push(structuredClone(data));
      for (const item of data) state.rows.push({ ...options.defaults(), ...stored(item), id: options.nextId() } as Row);
      return { count: data.length };
    },
    update: async ({ where, data, select }: { where: Where; data: Record<string, unknown>; select?: Record<string, boolean> }) => {
      const row = state.rows.find((candidate) => matches(candidate, where));
      if (!row) throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
      update(row, data);
      return pick(row, select);
    },
    updateMany: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      const rows = state.rows.filter((row) => matches(row, where));
      for (const row of rows) update(row, data);
      return { count: rows.length };
    },
  };
}

export function createFakeDb() {
  const state = {
    issues: { rows: [], updates: [] } as FakeTable,
    drafts: { rows: [], updates: [] } as FakeTable,
    outlines: { rows: [], updates: [] } as FakeTable,
    stories: { rows: [], updates: [] } as FakeTable,
    publishEvents: { rows: [], updates: [] } as FakeTable,
    settings: { rows: [], updates: [] } as FakeTable,
    locks: [] as unknown[][],
    /** Makes the next issue update fail with this error (then clears). */
    issueUpdateError: null as Error | null,
  };
  let nextId = 1000n;
  const id = () => nextId++;
  const now = () => new Date();

  const client = {
    issue: table(state.issues, {
      nextId: id,
      defaults: () => ({ publishedAt: null, html: null, featureImageUrl: null, excerpt: null, contentJson: null, promptFeaturedImage: null, createdAt: now() }),
      failUpdate: () => {
        const error = state.issueUpdateError;
        state.issueUpdateError = null;
        return error;
      },
    }),
    issueDraft: table(state.drafts, {
      nextId: id,
      unique: ["issueId", "version"],
      defaults: () => ({
        status: "running",
        currentStep: null,
        failedStep: null,
        error: null,
        content: null,
        html: null,
        featuredImageUrl: null,
        scenePrompt: null,
        ghlTemplateId: null,
        ghlPreviewUrl: null,
        unreadStoryIds: [],
        createdAt: now(),
        queuedAt: now(),
        startedAt: null,
        finishedAt: null,
      }),
    }),
    approvalOutline: table(state.outlines, { nextId: id, defaults: () => ({ committedAt: now(), forwardedAt: null }) }),
    story: table(state.stories, { nextId: id, defaults: () => ({}) }),
    publishEvent: table(state.publishEvents, { nextId: id, defaults: () => ({ draftId: null }) }),
    pipelineSetting: table(state.settings, { nextId: id, defaults: () => ({}) }),
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      state.locks.push([strings.join("?"), ...values]);
      return 1;
    },
    $transaction: async <T>(run: (tx: unknown) => Promise<T>): Promise<T> => {
      const snapshot = structuredClone({
        issues: state.issues.rows,
        drafts: state.drafts.rows,
        outlines: state.outlines.rows,
        stories: state.stories.rows,
        publishEvents: state.publishEvents.rows,
      });
      try {
        return await run(client);
      } catch (error) {
        state.issues.rows = snapshot.issues;
        state.drafts.rows = snapshot.drafts;
        state.outlines.rows = snapshot.outlines;
        state.stories.rows = snapshot.stories;
        state.publishEvents.rows = snapshot.publishEvents;
        throw error;
      }
    },
  };

  return {
    state,
    client,
    reset() {
      for (const key of ["issues", "drafts", "outlines", "stories", "publishEvents", "settings"] as const) {
        state[key].rows = [];
        state[key].updates = [];
      }
      client.publishEvent.createManyCalls.length = 0;
      state.locks.length = 0;
      state.issueUpdateError = null;
      nextId = 1000n;
      // Native drafting is on unless a test turns it off.
      state.settings.rows.push({ id: 1n, key: "draft.owner", value: "native" });
    },
  };
}

/** One shared fake per test file (vi.mock factories import it). */
export const fakeDb = createFakeDb();
