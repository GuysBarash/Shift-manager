import type { MetadataRoute } from "next";

// Makes the app installable (Android Chrome's native "Install app" prompt,
// iOS Safari's manual Share -> Add to Home Screen). Purely additive — the
// site works exactly as before for anyone who just opens the URL; this
// only adds the option to pin it as a standalone, app-like icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "מכלולון",
    short_name: "מכלולון",
    description: "לוח משמרות משותף לצוות",
    start_url: "/",
    display: "standalone",
    // Matches the app's own dark, green-glow theme (globals.css) rather
    // than the framework defaults — this is what a phone shows in the
    // status bar / splash screen the instant the icon is tapped.
    background_color: "#0d1310",
    theme_color: "#0d1310",
    // All three are the logo composited onto the app's own dark background
    // rather than left transparent — different platforms fill a
    // transparent PWA icon's background unpredictably (often white),
    // which is exactly the "white BG" this replaces. The maskable one is
    // shrunk further, on its own file, since Android crops it into a
    // circle/squircle/rounded-square depending on launcher and a
    // full-bleed logo would get its edges clipped.
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
