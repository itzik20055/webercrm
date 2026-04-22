export default function Loading() {
  return (
    <div className="px-4 pt-5 pb-4 space-y-4" aria-busy="true" aria-label="טוען">
      <header className="flex items-end justify-between gap-3">
        <div className="h-7 w-20 rounded-full bg-muted/40 animate-pulse" />
        <div className="flex gap-2">
          <div className="h-10 w-24 rounded-full bg-muted/30 animate-pulse" />
          <div className="h-10 w-20 rounded-full bg-muted/30 animate-pulse" />
        </div>
      </header>
      <div className="h-12 rounded-2xl bg-muted/25 animate-pulse" />
      <div className="flex gap-2 overflow-hidden">
        <div className="h-9 w-16 rounded-full bg-muted/25 animate-pulse shrink-0" />
        <div className="h-9 w-20 rounded-full bg-muted/25 animate-pulse shrink-0" />
        <div className="h-9 w-16 rounded-full bg-muted/25 animate-pulse shrink-0" />
        <div className="h-9 w-20 rounded-full bg-muted/25 animate-pulse shrink-0" />
      </div>
      <div className="space-y-2 pt-2">
        <div className="h-[92px] rounded-2xl bg-muted/20 animate-pulse" />
        <div className="h-[92px] rounded-2xl bg-muted/20 animate-pulse" />
        <div className="h-[92px] rounded-2xl bg-muted/20 animate-pulse" />
        <div className="h-[92px] rounded-2xl bg-muted/20 animate-pulse" />
      </div>
    </div>
  );
}
