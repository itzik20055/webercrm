export default function Loading() {
  return (
    <div className="px-4 pt-5 pb-6 space-y-5" aria-busy="true" aria-label="טוען">
      <header className="flex items-end justify-between gap-3">
        <div className="space-y-1.5">
          <div className="h-3 w-24 rounded-full bg-muted/30 animate-pulse" />
          <div className="h-7 w-28 rounded-full bg-muted/40 animate-pulse" />
          <div className="h-3 w-56 rounded-full bg-muted/25 animate-pulse" />
        </div>
      </header>
      <section className="space-y-2.5">
        <div className="h-4 w-32 rounded-full bg-muted/25 animate-pulse" />
        <div className="space-y-2">
          <div className="h-[110px] rounded-2xl bg-muted/20 animate-pulse" />
          <div className="h-[110px] rounded-2xl bg-muted/20 animate-pulse" />
          <div className="h-[110px] rounded-2xl bg-muted/20 animate-pulse" />
        </div>
      </section>
    </div>
  );
}
