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
    title: "משמרות",
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
        {children}
        <Toaster />
      </body>
    </html>
  );
}
