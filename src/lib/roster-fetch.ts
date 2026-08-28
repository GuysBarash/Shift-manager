import { google } from "googleapis";

// The shared roster spreadsheet both the "משיכה מ-Drive" button and the
// hourly cron read from.
// TODO: move to an env var if this ever needs to differ per deployment —
// for now it's the one link the group actually uses.
const SHEET_ID = "1lX6pvvlMfM42cMYCP8O1pmRlwGud9z1eBVXdvYUBUTg";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Server-side only (not the browser) specifically to dodge CORS — Google
// doesn't set permissive CORS headers on either path below, so a
// client-side fetch would be blocked outright regardless of which one runs.

/**
 * Preferred path: a Google service account (a machine identity you create
 * in Google Cloud Console and share the sheet with directly, like sharing
 * with a person) — keeps the sheet's general access "Restricted" instead of
 * "Anyone with the link." Only active once both env vars are set; see the
 * one-time setup note at the bottom of this file.
 */
async function fetchViaServiceAccount(email: string, rawKey: string): Promise<ArrayBuffer> {
  // Vercel env vars can't hold real newlines cleanly — the key is stored
  // with literal "\n" sequences and un-escaped here.
  const key = rawKey.replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.export(
    { fileId: SHEET_ID, mimeType: XLSX_MIME },
    { responseType: "arraybuffer" }
  );
  return res.data as ArrayBuffer;
}

/**
 * Fallback path: works only if the sheet is shared as "Anyone with the
 * link — Viewer." Kept so the button (and the cron) still do something
 * useful before the service account is set up.
 */
async function fetchViaPublicExport(): Promise<ArrayBuffer> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;
  const upstream = await fetch(url, { redirect: "follow" });

  // A private (or "restricted") sheet doesn't 404 here — Google redirects
  // to its login page and that comes back as an ordinary 200 HTML response,
  // so content-type not looking like a spreadsheet is the only reliable
  // signal that this didn't actually work.
  const contentType = upstream.headers.get("content-type") ?? "";
  if (!upstream.ok || !contentType.includes("spreadsheet")) {
    throw new Error("NOT_PUBLIC");
  }
  return upstream.arrayBuffer();
}

// Thrown with a ready-to-show Hebrew message — both callers (the button's
// route and the cron route) just surface err.message as-is.
export async function fetchRosterWorkbook(): Promise<ArrayBuffer> {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  try {
    return email && key ? await fetchViaServiceAccount(email, key) : await fetchViaPublicExport();
  } catch (err) {
    const message =
      email && key
        ? `לא ניתן לגשת לגיליון עם חשבון השירות. ודאו שהגיליון משותף עם ${email} (כצופה), ושה-Drive API מופעל בפרויקט. ${
            err instanceof Error ? err.message : ""
          }`
        : 'לא ניתן לגשת לגיליון. יש לשתף אותו ב-Google Sheets כ"כל מי שיש לו את הקישור – צפייה" (כפתור שיתוף בפינה הימנית העליונה), או להגדיר חשבון שירות (ראו הערה ב-roster-fetch.ts).';
    throw new Error(message);
  }
}

// --- One-time setup for the service-account path -------------------------
// 1. Google Cloud Console -> new (or existing) project -> enable "Google
//    Drive API".
// 2. IAM & Admin -> Service Accounts -> Create -> no roles needed (access
//    is granted per-file via sharing, not via IAM roles).
// 3. That service account's "Keys" tab -> Add Key -> JSON. Open it; you
//    need `client_email` and `private_key`.
// 4. Share the roster Google Sheet with `client_email` (Viewer) exactly
//    like sharing with a person. Leave general access "Restricted".
// 5. In Vercel: Project Settings -> Environment Variables, add
//    GOOGLE_SERVICE_ACCOUNT_EMAIL = client_email
//    GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = private_key (paste as-is, with
//      its \n sequences — this file un-escapes them at request time)
//    then redeploy. Nothing else changes; both callers pick the
//    service-account path automatically once both vars are present.
