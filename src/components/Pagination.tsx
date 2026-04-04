import React from "react";
import Link from "next/link";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  basePath: string;
}

const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  basePath,
}) => {
  const buildPageHref = (page: number) => {
    return page <= 1 ? basePath : `${basePath}?page=${page}`;
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[var(--border-light)] bg-[var(--bg-card)] px-4 py-4 sm:px-6">
      {/* Previous */}
      <Link
        href={buildPageHref(currentPage - 1)}
        aria-disabled={currentPage === 1}
        className={`inline-flex items-center justify-center rounded border px-5 py-2.5 font-semibold shadow-sm transition-[background-color,border-color,color,box-shadow,transform] ${
          currentPage === 1
            ? "pointer-events-none cursor-not-allowed border-[var(--border-light)] bg-[var(--bg-warm)] text-[var(--text-muted)] opacity-60"
            : "cursor-pointer border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:border-[var(--accent-primary)] hover:bg-[var(--bg-warm)] hover:shadow-md active:translate-y-px"
        }`}
        style={{ fontSize: 'var(--text-small)' }}
      >
        Previous
      </Link>

      {/* Page info + input */}
      <form action={basePath} className="flex items-center gap-2 whitespace-nowrap font-sans text-[var(--text-secondary)]">
        <span className="text-[var(--text-primary)]" style={{ fontSize: 'var(--text-body)' }}>Page</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          name="page"
          min={1}
          max={totalPages}
          defaultValue={currentPage}
          className="h-10 w-[4.5ch] min-w-[4.5ch] rounded border border-[var(--border)] bg-[var(--bg-warm)] px-1.5 text-center font-semibold text-[var(--text-primary)] tabular-nums outline-none transition-colors focus:border-[var(--accent-primary)] focus:bg-[var(--bg-card)]"
          style={{ fontSize: 'var(--text-body)' }}
        />
        <span className="tabular-nums" style={{ fontSize: 'var(--text-body)' }}>
          of <span className="ml-1 text-[var(--text-primary)]">{totalPages}</span>
        </span>
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-[var(--text-primary)] shadow-sm transition-[background-color,border-color,color,box-shadow,transform] hover:border-[var(--accent-primary)] hover:bg-[var(--bg-warm)] hover:shadow-md active:translate-y-px"
          style={{ fontSize: 'var(--text-small)' }}
        >
          Go
        </button>
      </form>

      {/* Next */}
      <Link
        href={buildPageHref(currentPage + 1)}
        aria-disabled={currentPage === totalPages}
        className={`inline-flex items-center justify-center rounded border px-5 py-2.5 font-semibold shadow-sm transition-[background-color,border-color,color,box-shadow,transform] ${
          currentPage === totalPages
            ? "pointer-events-none cursor-not-allowed border-[var(--border-light)] bg-[var(--bg-warm)] text-[var(--text-muted)] opacity-60"
            : "cursor-pointer border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:border-[var(--accent-primary)] hover:bg-[var(--bg-warm)] hover:shadow-md active:translate-y-px"
        }`}
        style={{ fontSize: 'var(--text-small)' }}
      >
        Next
      </Link>
    </div>
  );
};

export default Pagination;
