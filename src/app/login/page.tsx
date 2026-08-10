"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setStatus(error ? "error" : "sent");
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>מנהל משמרות</CardTitle>
          <CardDescription>
            {status === "sent"
              ? "בדקו את תיבת הדואר שלכם לקישור התחברות."
              : "הזינו אימייל כדי לקבל קישור התחברות."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status !== "sent" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">אימייל</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <Button type="submit" className="w-full" disabled={status === "sending"}>
                {status === "sending" ? "שולח..." : "שליחת קישור התחברות"}
              </Button>
              {status === "error" && (
                <p className="text-sm text-destructive">
                  משהו השתבש. נסו שוב, או בקשו מהמנהל להזמין את המייל שלכם קודם.
                </p>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
