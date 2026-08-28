import { NextResponse } from "next/server";
import { fetchRosterWorkbook, XLSX_MIME } from "@/lib/roster-fetch";

export async function GET() {
  try {
    const buffer = await fetchRosterWorkbook();
    return new NextResponse(buffer, {
      headers: { "content-type": XLSX_MIME, "cache-control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "שגיאה לא צפויה.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
