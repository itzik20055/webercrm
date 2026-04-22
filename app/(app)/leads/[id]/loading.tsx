export default function Loading() {
  return (
    <div className="pb-24" aria-busy="true" aria-label="טוען">
      <header className="sticky top-0 z-20 bg-background/85 backdrop-blur-xl border-b border-border/60 px-4 py-3 flex items-center gap-2">
        <div className="size-11 rounded-full bg-muted/40 animate-pulse" />
        <div className="h-5 flex-1 max-w-[60%] rounded-full bg-muted/40 animate-pulse" />
        <div className="size-11 rounded-full bg-muted/40 animate-pulse" />
        <div className="size-11 rounded-full bg-muted/40 animate-pulse" />
      </header>
      <div className="px-4 pt-4 space-y-5">
        <div className="grid grid-cols-3 gap-2">
          <div className="h-[76px] rounded-2xl bg-muted/30 animate-pulse" />
          <div className="h-[76px] rounded-2xl bg-muted/30 animate-pulse" />
          <div className="h-[76px] rounded-2xl bg-muted/30 animate-pulse" />
        </div>
        <div className="h-28 rounded-2xl bg-muted/25 animate-pulse" />
        <div className="h-20 rounded-2xl bg-muted/25 animate-pulse" />
        <div className="h-40 rounded-2xl bg-muted/25 animate-pulse" />
      </div>
    </div>
  );
}
