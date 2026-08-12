"""Import off-time (home) days + holidays from the team's reference Gantt
workbook into the app.

Re-run this any time the source workbook changes — it fully replaces the
previously-imported holidays list and every Sambatz person's off-time
entries with what's currently in the file, so it's safe to run repeatedly
as the schedule gets revised.

Usage:
    python scripts/import_offtime.py "<path to .xlsx>" [--apply-local] [--sql-only]

What it reads (sheet "מכלול כללי חדש" of the workbook):
  - Row 2: date header (one column per day)
  - Row 5: holiday name per date, where present
  - Column A: role, column B: full name, one row per person
  - A cell with 'X' in a person's row/date column means that person is
    AT HOME that day (off duty) — anything else (blank, 'V', ...) means
    they're presumed at base and needs no entry.

What it writes (into this scripts/ dir, always):
  - seed_offtime.sql   — replaces public.time_off for every person found
                          in the workbook (delete-then-insert, scoped to
                          just those people) and prints to stdout too
  - holiday dates       — printed as a ready-to-paste TS object literal
                          for src/lib/holidays.ts (that file isn't
                          auto-written since it's committed source, not
                          data — copy the block over by hand)

Person matching is by exact full_name against whatever's currently in the
local Supabase `profiles` table (via `supabase db query --local`), so a
name that doesn't exist yet in the app is skipped with a warning rather
than silently failing.
"""

import argparse
import subprocess
import sys
from pathlib import Path

import openpyxl

SHEET_NAME = "מכלול כללי חדש"
DATE_ROW = 2
HOLIDAY_ROW = 5
FIRST_DATA_ROW = 6
NAME_COL = 2
FIRST_DATE_COL = 3
HOME_MARK = "X"

DOCKER_EXE = r"C:\Users\Barash\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe"
DB_CONTAINER = "supabase_db_shift-manager"


def run_psql(sql: str) -> str:
    """Run SQL against the local Supabase DB via `docker exec ... psql`."""
    result = subprocess.run(
        [DOCKER_EXE, "exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", sql],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr)
    return result.stdout


def apply_sql_file(path: Path) -> None:
    with open(path, "r", encoding="utf-8") as f:
        result = subprocess.run(
            [DOCKER_EXE, "exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres"],
            stdin=f,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    print(result.stdout)
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        sys.exit(result.returncode)


def load_known_profile_names() -> set[str]:
    """Full names currently in the local profiles table."""
    try:
        out = run_psql("select full_name from public.profiles;")
    except Exception as e:
        print(f"warning: could not query local profiles ({e}), skipping name validation", file=sys.stderr)
        return set()
    return {line.strip() for line in out.splitlines() if line.strip()}


def extract(path: Path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[SHEET_NAME]

    max_col = ws.max_column
    dates = {}
    for c in range(FIRST_DATE_COL, max_col + 1):
        d = ws.cell(row=DATE_ROW, column=c).value
        if d:
            dates[c] = d.date()

    holidays = {}
    for c, d in dates.items():
        h = ws.cell(row=HOLIDAY_ROW, column=c).value
        if h:
            holidays[d.isoformat()] = h

    people = {}
    for r in range(FIRST_DATA_ROW, ws.max_row + 1):
        name = ws.cell(row=r, column=NAME_COL).value
        if not name:
            continue
        home_dates = []
        for c, d in dates.items():
            v = ws.cell(row=r, column=c).value
            if v == HOME_MARK:
                home_dates.append(d)
        home_dates.sort()
        ranges = []
        for d in home_dates:
            if ranges and (d - ranges[-1][1]).days == 1:
                ranges[-1] = (ranges[-1][0], d)
            else:
                ranges.append((d, d))
        people[name] = ranges

    return holidays, people


def build_sql(people: dict[str, list], known_names: set[str]) -> str:
    matched = {name: ranges for name, ranges in people.items() if not known_names or name in known_names}
    skipped = [name for name in people if known_names and name not in known_names]
    for name in skipped:
        print(f"warning: '{name}' not found in profiles table, skipping", file=sys.stderr)

    names_sql = ", ".join(f"'{n.replace(chr(39), chr(39) * 2)}'" for n in matched)
    delete_sql = (
        f"delete from public.time_off using public.profiles p "
        f"where p.id = time_off.user_id and p.full_name in ({names_sql});\n\n"
        if matched
        else ""
    )

    rows = []
    for name, ranges in matched.items():
        esc = name.replace("'", "''")
        for s, e in ranges:
            rows.append(f"  ('{esc}', date '{s.isoformat()}', date '{e.isoformat()}')")

    if not rows:
        return delete_sql + "-- no off-time ranges found to insert\n"

    insert_sql = (
        "insert into public.time_off (user_id, start_date, end_date)\n"
        "select p.id, v.start_date, v.end_date from (values\n"
        + ",\n".join(rows)
        + "\n) as v(full_name, start_date, end_date)\n"
        "join public.profiles p on p.full_name = v.full_name;\n"
    )
    return delete_sql + insert_sql


def build_holidays_ts(holidays: dict[str, str]) -> str:
    lines = ["export const ISRAELI_HOLIDAYS: Record<string, string> = {"]
    for date in sorted(holidays):
        name = holidays[date].replace('"', '\\"')
        lines.append(f'  "{date}": "{name}",')
    lines.append("};")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("xlsx", type=Path)
    parser.add_argument("--apply-local", action="store_true", help="also run the SQL against the local DB")
    args = parser.parse_args()

    holidays, people = extract(args.xlsx)
    known_names = load_known_profile_names()
    sql = build_sql(people, known_names)

    out_dir = Path(__file__).resolve().parent
    sql_path = out_dir / "seed_offtime.sql"
    sql_path.write_text(sql, encoding="utf-8")

    print("=" * 60)
    print(f"Holidays found: {len(holidays)}")
    print("Paste into src/lib/holidays.ts:")
    print()
    print(build_holidays_ts(holidays))
    print()
    print("=" * 60)
    print(f"SQL written to {sql_path}")
    print(sql)

    if args.apply_local:
        print("Applying to local DB...")
        result = subprocess.run(
            ["npx", "supabase", "db", "query", "--local", "-f", str(sql_path)],
            cwd=out_dir.parent,
            shell=True,
        )
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
