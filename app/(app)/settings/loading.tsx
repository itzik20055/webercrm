export default function Loading() {
  return (
    <div className="px-4 pt-4 pb-4 space-y-5" aria-busy="true" aria-label="טוען">
      <div className="h-8 w-24 rounded-full bg-muted/40 animate-pulse" />
      {[0, 1, 2, 3, 4].map((i) => (
        <section key={i} className="space-y-3">
          <div className="h-4 w-32 rounded-full bg-muted/25 animate-pulse" />
          <div className="h-28 rounded-xl bg-muted/20 animate-pulse" />
        </section>
      ))}
    </div>
  );
}
