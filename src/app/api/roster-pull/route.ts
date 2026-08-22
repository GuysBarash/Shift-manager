import { NextResponse } from "next/server";

// The shared roster spreadsheet the "משיכה מ-Drive" button reads from.
// TODO: move to an env var if this ever needs to differ per deployment —
// for now it's the one link the group actually uses.
const SHEET_ID = "1lX6pvvlMfM42cMYCP8O1pmRlwGud9z1eBVXdvYUBUTg";

// Runs server-side (not in the browser) specifically to dodge CORS — Google
// doesn't set permissive CORS headers on the export endpoint, so a
// client-side fetch would be blocked outright. A server-to-server request
// has no such restriction.
export async function GET() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;
  const upstream = await fetch(url, { redirect: "follow" });

  // A private (or "restricted") sheet doesn't 404 here — Google redirects
  // to its login page and that comes back as an ordinary 200 HTML response,
  // so content-type not looking like a spreadsheet is the only reliable
  // signal that this didn't actually work.
  const contentType = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !contentType.includes("spreadsheet")) {
    return NextResponse.json(
      {
        error:
          'לא ניתן לגשת לגיליון. יש לשתף אותו ב-Google Sheets כ"כל מי שיש לו את הקישור – צפייה" (כפתור שיתוף בפינה הימנית העליונה).',
      },
      { status: 502 }
    );
  }

  const buffer = await upstream.arrayBuffer();
  return new NextResponse(buffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "cache-control": "no-store",
    },
  });
}
