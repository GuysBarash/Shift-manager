// Shared by the shifts and off-time pages so their timelines always end on
// the same date — a page-local constant here would silently drift from the
// other page's.
export const SCHEDULE_RANGE_DAYS = 120;
