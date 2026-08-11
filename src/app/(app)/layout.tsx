import { NavBar } from "@/components/nav-bar";
import { DemoIdentityProvider } from "@/lib/demo-identity";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <DemoIdentityProvider>
      <div className="min-h-screen">
        <NavBar />
        <main className="mx-auto max-w-6xl p-2 sm:p-4">{children}</main>
      </div>
    </DemoIdentityProvider>
  );
}
