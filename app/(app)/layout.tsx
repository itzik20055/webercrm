import { BottomNav } from "@/components/bottom-nav";
import { GlobalCaptureFab } from "@/components/global-capture-fab";
import { getQueueCount } from "@/lib/queue-count";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const queueCount = await getQueueCount().catch(() => 0);
  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <main className="flex-1 pb-24 max-w-lg w-full mx-auto">{children}</main>
      <GlobalCaptureFab />
      <BottomNav queueCount={queueCount} />
    </div>
  );
}
