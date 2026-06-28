import { ChevronLeft, ChevronRight } from "lucide-react";

/** Prev/Next + page indicator for server-paginated lists -- plain component in the same
 * style as DateRangePicker/SortableHeader, not a generic data-grid abstraction. */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between gap-3 text-sm text-ink-400">
      <span>
        {total === 0 ? "No results" : `Showing ${from}-${to} of ${total.toLocaleString()}`}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft size={14} /> Prev
        </button>
        <span className="font-mono text-xs">
          Page {page} / {totalPages}
        </span>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
