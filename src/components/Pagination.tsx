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
    <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
      {/* Previous */}
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className={`px-6 py-2 rounded-lg bg-primary text-primary-foreground font-medium
          transition-colors hover:bg-primary/90
          ${currentPage === 1 ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        Previous
      </button>

      {/* Page info + input */}
      <div className="flex items-center gap-2 text-foreground">
        <span>Page</span>

        <input
          type="text"
          min={1}
          max={totalPages}
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          onBlur={handleInputSubmit}
          onKeyDown={(e) => e.key === "Enter" && handleInputSubmit()}
          className="
            w-16 px-2 py-1
            border border-border rounded-md
            bg-white text-center
            focus:outline-none focus:ring-2 focus:ring-ring
            appearance-none
          "
        />

        <span>of {totalPages}</span>
      </div>

      {/* Next */}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className={`px-6 py-2 rounded-lg bg-secondary text-secondary-foreground font-medium
          transition-colors hover:bg-secondary/80
          ${currentPage === totalPages ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        Next
      </button>
    </div>
  );
};

export default Pagination;

