import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Serves public.user_last_seen (defined in
// supabase/migrations/20260101000006_user_activity.sql) to the "גישה" admin
// page. The view is deliberately unreadable with the anon key (see
// .../20260101000007_user_activity_lockdown.sql — it once leaked the whole
// usage log through the public key that ships in the bundle), so this route
// reads it with the service-role key, which bypasses RLS.
//
// That makes this route the only thing standing in front of the data, and the
// gate can't be the caller's claimed identity: there's no real auth in this
// app (cookie-based demo identity, see src/lib/demo-identity.tsx), and admin
// profile ids are readable by anyone holding the anon key (`profiles.is_admin`
// is open to anon). A "?userId=<admin id>" check would let anyone through.
// Instead the caller must present ACCESS_LOG_KEY — a secret that exists only
// in the server's environment and with whoever the admin gives it to.
//
// Fails closed: with either secret missing from the environment, nothing is
// served. Set both on Vercel (Production) to turn the tab on.

// Hashing both sides first gives timingSafeEqual the equal-length inputs it
// requires, without leaking the real key's length through an early mismatch.
function sameSecret(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const accessKey = process.env.ACCESS_LOG_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!accessKey || !serviceKey) {
    return NextResponse.json(
      {
        error:
          "הלשונית לא הופעלה בשרת: יש להגדיר גם ACCESS_LOG_KEY וגם SUPABASE_SERVICE_ROLE_KEY במשתני הסביבה של Vercel ולפרוס מחדש.",
      },
      { status: 503 }
    );
  }

  const provided = request.headers.get("x-access-key") ?? "";
  if (!sameSecret(provided, accessKey)) {
    return NextResponse.json({ error: "קוד גישה שגוי." }, { status: 401 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey);
  const { data, error } = await supabase
    .from("user_last_seen")
    .select("user_id, full_name, visit_count, last_seen_at, first_seen_at")
    .order("last_seen_at", { ascending: false, nullsFirst: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The body depends on a request header, so no shared cache may ever keep it.
  return NextResponse.json({ rows: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
