import { formatDDMMYYYY, formatDowShort, formatHourLabel } from "@/lib/dates";
import { ISRAELI_HOLIDAYS } from "@/lib/holidays";
import { isOnTimeOffAtHour } from "@/lib/roster";
import type { Profile, Shift, TimeOff } from "@/types/database";

export function FragmentDay({
  iso,
  day,
  dayGrid,
  columns,
  isToday,
  currentHour,
  profileById,
  colorAssignments,
  timeOffIndex,
  userId,
  brushActive,
  onPaintDown,
  onPaintEnter,
  renderExtraCells,
}: {
  iso: string;
  day: Date;
  dayGrid: Record<string, Shift | null>[];
  columns: string[];
  isToday: boolean;
  currentHour: number;
  profileById: Map<string, Profile>;
  colorAssignments: Map<string, { name: string; hex: string }>;
  // Lets an assigned-but-currently-home shift show crossed out — a real
  // scheduling conflict, so it should be unmistakable right on the main
  // grid, not just in the extended per-person view.
  timeOffIndex: Map<string, TimeOff[]>;
  userId: string;
  brushActive: boolean;
  onPaintDown: (hour: number, col: string) => void;
  onPaintEnter: (hour: number, col: string) => void;
  // Lets the extended per-person view append its cells to this SAME <tr>
  // instead of living in a second, independent <table> — two separate
  // tables can never be guaranteed pixel-identical row heights (sub-pixel
  // rounding differences compound over hundreds of rows), one table can't
  // drift from itself.
  renderExtraCells?: (hour: number) => React.ReactNode;
}) {
  return (
    <>
      {dayGrid.map((row, hour) => {
        const isNowRow = isToday && hour === currentHour;
        const isShabbat = day.getDay() === 6;
        const holiday = ISRAELI_HOLIDAYS[iso];
        return (
          <tr key={`${iso}-${hour}`} id={`row-${iso}-${hour}`}>
            {hour === 0 && (
              <td
                rowSpan={24}
                className={`sticky start-0 z-10 w-14 min-w-14 max-w-14 border-b border-e border-border/60 bg-secondary px-1 py-1.5 align-top font-mono leading-tight ${
                  isToday || isShabbat || holiday ? "text-primary glow-text" : "text-secondary-foreground"
                }`}
              >
                <div className="text-xs font-bold">
                  {formatDowShort(day)}
                  {holiday && ` (${holiday})`}
                </div>
                <div className="text-[10px]">{formatDDMMYYYY(day)}</div>
                {isToday && <div className="text-[9px] text-primary glow-text">היום</div>}
              </td>
            )}
            <td
              className={`sticky start-14 z-10 h-8 w-16 min-w-16 max-w-16 border-b border-border/60 bg-card px-1 py-1.5 font-mono text-xs leading-tight whitespace-nowrap ${
                isNowRow ? "text-primary glow-text font-bold" : "text-muted-foreground"
              }`}
            >
              {formatHourLabel(hour)}
              {isNowRow && <span className="animate-pulse">◄</span>}
            </td>
            {columns.map((col) => {
              const shift = row[col];
              const assignee = shift?.assigned_to ? profileById.get(shift.assigned_to) : null;
              const color = shift?.assigned_to ? colorAssignments.get(shift.assigned_to) : null;
              const isMine = shift?.assigned_to === userId;
              const atHome = shift?.assigned_to
                ? isOnTimeOffAtHour(timeOffIndex, shift.assigned_to, iso, hour)
                : false;

              return (
                <td
                  key={col}
                  onMouseDown={() => onPaintDown(hour, col)}
                  onMouseEnter={() => onPaintEnter(hour, col)}
                  className={`h-8 overflow-hidden border-b border-s border-border/60 px-3 py-1.5 transition-colors hover:brightness-125 ${
                    brushActive ? "cursor-crosshair" : "cursor-default"
                  } ${isNowRow && !shift ? "bg-primary/10" : ""} ${
                    isMine ? "ring-1 ring-inset ring-primary/50" : ""
                  }`}
                  style={
                    shift
                      ? {
                          backgroundColor: color ? `${color.hex}22` : undefined,
                          borderInlineStart: color ? `3px solid ${color.hex}` : undefined,
                        }
                      : undefined
                  }
                >
                  {shift && assignee ? (
                    // block+truncate instead of letting a long two-word name
                    // wrap to a second line — a wrapped row would be taller
                    // than the same row in the extended per-person table
                    // next to it, throwing the two tables out of alignment.
                    <span
                      className={`block truncate font-medium ${atHome ? "line-through opacity-70" : ""}`}
                      style={{ color: color?.hex, textShadow: color ? `0 0 6px ${color.hex}66` : undefined }}
                      title={atHome ? "משובץ אך נמצא בבית" : undefined}
                    >
                      {assignee.full_name}
                    </span>
                  ) : (
                    // A truly empty cell (no text node at all) collapses its
                    // line-box height, making this row shorter than rows with
                    // a real name — the exact bug that misaligned the
                    // extended table before. An invisible non-breaking space
                    // keeps the cell visually empty while holding the height.
                    <span aria-hidden="true">{" "}</span>
                  )}
                </td>
              );
            })}
            {renderExtraCells?.(hour)}
          </tr>
        );
      })}
    </>
  );
}
