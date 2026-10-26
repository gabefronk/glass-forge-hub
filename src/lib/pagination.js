/**
 * Fetch every record of an entity, in `sort` order. Same helper as the backend
 * (base44/shared/pagination.ts): pages walk the records by id, so records that share
 * a created_date are never repeated or missed between pages.
 *
 * Use this only when you genuinely need ALL records (cross-job aggregates,
 * full timelines). For month-scoped or job-scoped views, prefer filter()
 * with a high limit — a single month or job will never approach 5000 rows.
 */
export { fetchAllPages } from "../../base44/shared/pagination.ts";
