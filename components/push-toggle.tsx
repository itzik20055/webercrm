"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { BellRing, BellOff, Send } from "lucide-react";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string | undefined }) {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [subscribed, setSubscribed] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
    navigator.serviceWorker.ready.then((reg) =>
      reg.pushManager.getSubscription().then((s) => setSubscribed(!!s))
    );
  }, []);

  if (permission === "unsupported") {
    return (
      <p className="text-sm text-muted-foreground">
        הדפדפן הזה לא תומך בהתראות. נסה לפתוח באפליקציה (PWA) על iOS 16.4+ או דפדפן מודרני.
      </p>
    );
  }

  if (!vapidPublicKey) {
    return (
      <p className="text-sm text-amber-600">
        חסר VAPID public key. הגדר NEXT_PUBLIC_VAPID_PUBLIC_KEY ב-env.
      </p>
    );
  }

  async function enable() {
    const perm = await Notification.requestPermission();
    setPermission(perm);
    if (perm !== "granted") {
      toast.error("ההרשאה נדחתה");
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!),
    });
    const r = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });
    if (r.ok) {
      setSubscribed(true);
      toast.success("התראות הופעלו");
    } else {
      toast.error("שגיאה בהפעלת התראות");
    }
  }

  async function disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    setSubscribed(false);
    toast.success("התראות בוטלו");
  }

  async function sendTest() {
    try {
      const r = await fetch("/api/push/test", { method: "POST" });
      const json = await r.json();
      if (r.ok && json.sent > 0) {
        toast.success(`התראת בדיקה נשלחה (${json.sent} מכשירים)`);
      } else if (json.sent === 0) {
        toast.error("אין מכשירים מנויים");
      } else {
        toast.error(json.error ?? "שליחה נכשלה");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  if (subscribed) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => start(sendTest)}
          className="press w-full h-12 rounded-xl bg-primary text-primary-foreground flex items-center justify-center gap-2 font-semibold shadow-card"
        >
          <Send className="size-4" />
          שלח התראת בדיקה
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => start(disable)}
          className="press w-full h-11 rounded-xl border border-border flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground"
        >
          <BellOff className="size-4" />
          בטל התראות
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(enable)}
      className="w-full h-12 rounded-lg bg-primary text-primary-foreground flex items-center justify-center gap-2 font-medium active:scale-[0.98] transition"
    >
      <BellRing className="size-4" />
      הפעל התראות פולואפ
    </button>
  );
}
