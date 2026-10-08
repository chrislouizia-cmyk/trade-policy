"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function TraderIntelligenceTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (
      pathname === "/" ||
      /^\/(login|signup|auth|hq|portal|reset|forgot)/.test(pathname)
    ) return;
    const controller = new AbortController();
    void fetch("/api/trader-intelligence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        route: pathname,
      }),
      signal: controller.signal,
    }).catch(() => {});
    return () => controller.abort();
  }, [pathname]);
  return null;
}
