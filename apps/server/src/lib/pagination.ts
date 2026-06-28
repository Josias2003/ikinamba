import type { Request } from "express";

export interface PageParams {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDir: "asc" | "desc";
  search: string;
}

const MAX_PAGE_SIZE = 100;

/** Reads ?page=&pageSize=&sortBy=&sortDir=&search= off a request -- shared by every
 * listing endpoint large enough to need real pagination instead of a hardcoded `take`. */
export function readPageParams(req: Request, allowedSortFields: readonly string[]): PageParams {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.pageSize as string, 10) || 20));
  const sortByRaw = req.query.sortBy as string | undefined;
  const sortBy = sortByRaw && allowedSortFields.includes(sortByRaw) ? sortByRaw : undefined;
  const sortDir = req.query.sortDir === "desc" ? "desc" : "asc";
  const search = ((req.query.search as string) ?? "").trim();
  return { page, pageSize, sortBy, sortDir, search };
}

export interface PagedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function pagedResult<T>(data: T[], total: number, params: PageParams): PagedResult<T> {
  return { data, total, page: params.page, pageSize: params.pageSize };
}
