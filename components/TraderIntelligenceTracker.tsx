"use client";

import { useEffect } from "react";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { usePathname } from "next/navigation";

export default function TraderIntelligenceTracker() {
  const pathname = usePathname();
  const {locale} = useLocale();
  useEffect(() => {
    if (
      pathname === "/" ||
      /^\/(login|signup|auth|hq|portal|reset|forgot)/.test(pathname)
    ) return;
    const controller = new AbortController();
    const update = () => { if (document.visibilityState !== "visible") return; void fetch("/api/trader-intelligence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        route: pathname,
        locale,
      }),
      signal: controller.signal,
    }).catch(() => {}); };
    update();
    const timer = window.setInterval(update, 5 * 60_000);
    document.addEventListener("visibilitychange",update);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange",update); };
  }, [pathname,locale]);
  return null;
}
