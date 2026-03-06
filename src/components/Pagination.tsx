'use client'
import React, { useState, useEffect } from "react";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
}) => {
  const [pageInput, setPageInput] = useState(currentPage.toString());

  // sync input when page changes from buttons
  useEffect(() => {
    setPageInput(currentPage.toString());
  }, [currentPage]);

  const handleInputChange = (value: string) => {
    const sanitizedValue = value.replace(/\D/g, "");
    setPageInput(sanitizedValue);
  };

  const handleInputSubmit = () => {
    const page = Number(pageInput);

    if (!Number.isNaN(page) && page >= 1 && page <= totalPages) {
      onPageChange(page);
    } else {
      // reset invalid input
      setPageInput(currentPage.toString());
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[var(--border-light)] bg-[var(--bg-card)] px-4 py-4 sm:px-6">
      {/* Previous */}
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className={`inline-flex items-center justify-center rounded border px-5 py-2.5 font-semibold shadow-sm transition-[background-color,border-color,color,box-shadow,transform] ${
          currentPage === 1
            ? "cursor-not-allowed border-[var(--border-light)] bg-[var(--bg-warm)] text-[var(--text-muted)] opacity-60"
            : "cursor-pointer border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:border-[var(--accent-primary)] hover:bg-[var(--bg-warm)] hover:shadow-md active:translate-y-px"
        }`}
        style={{ fontSize: 'var(--text-small)' }}
      >
        Previous
      </button>

      {/* Page info + input */}
      <div
        className="flex items-center gap-2 whitespace-nowrap font-sans text-[var(--text-secondary)]"
        style={{ fontSize: 'var(--text-body)' }}
      >
        <span className="text-[var(--text-primary)]">Page</span>

        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          min={1}
          max={totalPages}
          value={pageInput}
          onChange={(e) => handleInputChange(e.target.value)}
          onBlur={handleInputSubmit}
          onKeyDown={(e) => e.key === "Enter" && handleInputSubmit()}
          className="h-10 w-[4.5ch] min-w-[4.5ch] rounded border border-[var(--border)] bg-[var(--bg-warm)] px-1.5 text-center font-semibold text-[var(--text-primary)] tabular-nums outline-none transition-colors focus:border-[var(--accent-primary)] focus:bg-[var(--bg-card)]"
          style={{ fontSize: 'var(--text-body)' }}
        />

        <span className="tabular-nums">
          of <span className="ml-1 text-[var(--text-primary)]">{totalPages}</span>
        </span>
      </div>

      {/* Next */}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className={`inline-flex items-center justify-center rounded border px-5 py-2.5 font-semibold shadow-sm transition-[background-color,border-color,color,box-shadow,transform] ${
          currentPage === totalPages
            ? "cursor-not-allowed border-[var(--border-light)] bg-[var(--bg-warm)] text-[var(--text-muted)] opacity-60"
            : "cursor-pointer border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:border-[var(--accent-primary)] hover:bg-[var(--bg-warm)] hover:shadow-md active:translate-y-px"
        }`}
        style={{ fontSize: 'var(--text-small)' }}
      >
        Next
      </button>
    </div>
  );
};

export default Pagination;
