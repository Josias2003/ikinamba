import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

export type SortDirection = "asc" | "desc";
export interface SortState<F extends string> {
  field: F | null;
  direction: SortDirection;
}

/** Clickable <th> with a sort-direction indicator -- click cycles asc -> desc -> asc on
 * that column, switching field resets to asc. Plain useState/useMemo on the page side
 * (see Customers.tsx for the pattern), not a generic table component -- matches how the
 * rest of the app already does this rather than introducing a new abstraction. */
export function SortableHeader<F extends string>({
  field,
  label,
  sort,
  onSort,
  className,
}: {
  field: F;
  label: string;
  sort: SortState<F>;
  onSort: (field: F) => void;
  className?: string;
}) {
  const active = sort.field === field;
  const Icon = active ? (sort.direction === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <th className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`flex items-center gap-1 hover:text-ink-100 transition-colors ${active ? "text-ink-100" : ""}`}
      >
        {label}
        <Icon size={12} className={active ? "text-brand-400" : "text-ink-600"} />
      </button>
    </th>
  );
}

export function toggleSort<F extends string>(sort: SortState<F>, field: F): SortState<F> {
  if (sort.field !== field) return { field, direction: "asc" };
  return { field, direction: sort.direction === "asc" ? "desc" : "asc" };
}

export function compareBy<T>(a: T, b: T, getValue: (item: T) => string | number, direction: SortDirection) {
  const av = getValue(a);
  const bv = getValue(b);
  const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
  return direction === "asc" ? cmp : -cmp;
}
