import type { MetadataRoute } from "next";

// Makes the app installable (Android Chrome's native "Install app" prompt,
// iOS Safari's manual Share -> Add to Home Screen). Purely additive — the
// site works exactly as before for anyone who just opens the URL; this
// only adds the option to pin it as a standalone, app-like icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "מנהל משמרות",
    short_name: "משמרות",
    description: "לוח משמרות משותף לצוות",
    start_url: "/",
    display: "standalone",
    // Matches the app's own dark, green-glow theme (globals.css) rather
    // than the framework defaults — this is what a phone shows in the
    // status bar / splash screen the instant the icon is tapped.
    background_color: "#0d1310",
    theme_color: "#0d1310",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
