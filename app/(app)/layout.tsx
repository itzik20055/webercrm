import { Suspense } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { GlobalSearchFab } from "@/components/global-search-fab";
import { getQueueCount, getInboxCount } from "@/lib/queue-count";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh flex flex-col bg-background">
      <main className="flex-1 pb-24 max-w-lg w-full mx-auto">{children}</main>
      <GlobalSearchFab />
      <Suspense fallback={<BottomNav />}>
        <BottomNavWithCounts />
      </Suspense>
    </div>
  );
}

async function BottomNavWithCounts() {
  const [queueCount, inboxCount] = await Promise.all([
    getQueueCount().catch(() => 0),
    getInboxCount().catch(() => 0),
  ]);
  return <BottomNav queueCount={queueCount} inboxCount={inboxCount} />;
}
