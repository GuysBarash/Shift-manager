import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { applyOffTimeImport, parseOffTimeWorkbook } from "@/lib/offtime-import";
import { fetchRosterWorkbook } from "@/lib/roster-fetch";
import type { Database } from "@/types/database";

// Triggered hourly by vercel.json's `crons` entry — does exactly what the
// off-time page's "משיכה מ-Drive" button does, just without a human
// clicking it. No browser context here (serverless function, no DOM), so
// it uses the plain supabase-js client with the anon key directly rather
// than either of the app's cookie-aware clients — this route has no user
// session to carry anyway, and RLS is open to anon in this app's current
// demo-mode setup.
export async function GET(request: Request) {
  // Vercel sends `Authorization: Bearer $CRON_SECRET` on its own
  // cron-triggered requests once that env var is set — checking it stops
  // anyone else from hitting this URL and forcing a time_off overwrite.
  const expected = process.env.CRON_SECRET;
  if (expected) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${expected}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  try {
    const buffer = await fetchRosterWorkbook();
    const extraction = parseOffTimeWorkbook(buffer);

    const { data: profiles, error: profileError } = await supabase.from("profiles").select("*");
    if (profileError) throw profileError;

    const result = await applyOffTimeImport(extraction, profiles ?? [], supabase);
    return NextResponse.json({ ok: true, at: new Date().toISOString(), ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "שגיאה לא צפויה.";
    console.error("[cron/pull-roster]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
