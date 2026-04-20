import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { login, isAuthenticated } from "@/lib/session";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  if (await isAuthenticated()) {
    redirect("/");
  }
  const sp = await searchParams;

  async function action(formData: FormData) {
    "use server";
    const password = String(formData.get("password") ?? "");
    const next = String(formData.get("next") ?? "/");
    const ok = await login(password);
    if (!ok) {
      redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
    }
    redirect(next || "/");
  }

  return (
    <form action={action} className="w-full max-w-sm space-y-5">
      <div className="text-center space-y-2">
        <div className="text-3xl font-bold">Weber Leads</div>
        <p className="text-sm text-muted-foreground">המערכת האישית שלך</p>
      </div>
      <input type="hidden" name="next" value={sp.next ?? "/"} />
      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium">סיסמה</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          aria-invalid={sp.error ? "true" : undefined}
          aria-describedby={sp.error ? "login-error" : undefined}
          className="w-full h-12 px-4 rounded-lg border border-input bg-card text-base focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      {sp.error && (
        <p
          id="login-error"
          role="alert"
          aria-live="polite"
          className="text-sm text-destructive flex items-center gap-1.5"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          סיסמה שגויה
        </p>
      )}
      <button
        type="submit"
        className="press w-full h-12 rounded-lg bg-primary text-primary-foreground font-medium text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
      >
        כניסה
      </button>
    </form>
  );
}
