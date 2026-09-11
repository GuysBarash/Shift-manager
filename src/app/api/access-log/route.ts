import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Serves public.user_last_seen (defined in
// supabase/migrations/20260101000006_user_activity.sql) to the "גישה" admin
// page. That table/view is deliberately locked down from anon/authenticated
// (see .../20260101000007_user_activity_lockdown.sql — it was found to leak
// the whole usage log through the public anon key) so this route uses the
// service-role key instead, which bypasses RLS, and does its own admin check
// before returning anything.
//
// There's no real auth in this app (cookie-based demo identity only — see
// src/lib/demo-identity.tsx), so "admin check" means looking up the profile
// the caller CLAIMS to be and checking is_admin, same trust level as every
// other admin-gated control in this app (all client-side). What this route
// adds over that is that the underlying data stays behind the service key
// instead of a second open RLS grant — someone would need to know a real
// admin's profile id, not just the public anon key that ships in the bundle.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requesterId = searchParams.get("userId");
  if (!requesterId) {
    return NextResponse.json({ error: "חסר מזהה משתמש." }, { status: 400 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      {
        error:
          "לא הוגדר מפתח שירות (SUPABASE_SERVICE_ROLE_KEY) בשרת. יש להוסיף אותו במשתני הסביבה של Vercel ולפרוס מחדש.",
      },
      { status: 503 }
    );
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey);

  const { data: requester, error: requesterError } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", requesterId)
    .maybeSingle();
  if (requesterError) {
    return NextResponse.json({ error: requesterError.message }, { status: 500 });
  }
  if (!requester?.is_admin) {
    return NextResponse.json({ error: "אין הרשאה." }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("user_last_seen")
    .select("user_id, full_name, visit_count, last_seen_at, first_seen_at")
    .order("last_seen_at", { ascending: false, nullsFirst: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rows: data ?? [] });
}
