import { NextResponse, type NextRequest } from "next/server";

// TEMPORARY DEMO MODE: the real Supabase-auth redirect is disabled while the
// app runs on the cookie-based name gate (see src/lib/demo-identity.tsx).
// To restore real auth, replace the body below with:
//   import { updateSession } from "@/lib/supabase/middleware";
//   return updateSession(request);
export async function proxy(request: NextRequest) {
  return NextResponse.next({ request });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
