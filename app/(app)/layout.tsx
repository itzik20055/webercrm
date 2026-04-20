import { BottomNav } from "@/components/bottom-nav";
import { GlobalCaptureFab } from "@/components/global-capture-fab";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <main className="flex-1 pb-24 max-w-lg w-full mx-auto">{children}</main>
      <GlobalCaptureFab />
      <BottomNav />
    </div>
  );
}
