import { BottomNav } from "@/components/bottom-nav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 pb-20 max-w-lg w-full mx-auto">{children}</main>
      <BottomNav />
    </div>
  );
}
