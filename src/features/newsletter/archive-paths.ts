// Archive pages live in the path, so the CDN can cache each one: `/archive` is page 1, `/archive/page/N` is page N.

export const ARCHIVE_PATH = "/archive";

/** Issues on one archive page. */
export const ARCHIVE_PAGE_SIZE = 6;

export function archivePagePath(page: number): string {
  return page <= 1 ? ARCHIVE_PATH : `${ARCHIVE_PATH}/page/${page}`;
}

/** The page number in `/archive/page/N`, or null when N is not a whole number of 1 or more. */
export function parseArchivePageNumber(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const page = Number.parseInt(value, 10);
  return Number.isSafeInteger(page) && page >= 1 ? page : null;
}
