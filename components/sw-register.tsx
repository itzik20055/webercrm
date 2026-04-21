"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function SwRegister() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});

    // The service worker posts {type:"navigate", url} when the user taps a
    // notification while a PWA window is already open. iOS Safari ignores
    // client.navigate() in the SW, so we route from here instead.
    function onMessage(e: MessageEvent) {
      const data = e.data;
      if (data && data.type === "navigate" && typeof data.url === "string") {
        router.push(data.url);
      }
    }
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [router]);
  return null;
}
