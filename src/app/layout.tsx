import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "מנהל משמרות",
  description: "לוח משמרות משותף לצוות",
  // iOS Safari doesn't fully honor the web manifest (manifest.ts) the way
  // Android Chrome does — these are what actually make "Add to Home
  // Screen" open full-screen there instead of inside Safari's own chrome.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "מכלולון",
  },
  // Belt and suspenders — appleWebApp.capable is documented to emit this
  // tag by itself, but it didn't show up in the rendered page, so it's set
  // directly too. Without it, an iOS "Add to Home Screen" icon still just
  // opens Safari with its normal chrome instead of full-screen.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Capture Chrome's `beforeinstallprompt` the instant it fires. It's
            dispatched once, very early — routinely before React hydrates and
            NavBar's own listener attaches — and if nothing is listening at
            that moment the event is gone until the next full navigation.
            Stashing it on `window` here, during HTML parse, is what stops the
            logo's install click from intermittently doing nothing on Android.
            NavBar reads `window.__installPrompt` on mount and also listens for
            the `installpromptchange` event this dispatches. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__installPrompt=e;window.dispatchEvent(new Event('installpromptchange'))});window.addEventListener('appinstalled',function(){window.__installPrompt=null;window.dispatchEvent(new Event('installpromptchange'))})})();",
          }}
        />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
