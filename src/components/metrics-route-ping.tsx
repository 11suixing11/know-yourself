"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { classifyRoute, pingRouteView } from "@/lib/metrics";

/**
 * Renders nothing. Emits one anonymous aggregate route-view counter per
 * funnel-relevant route class, deduplicated per device per day by the ping
 * ledger. Pages outside the measured funnel (account, settings, admin,
 * complaints, privacy) deliberately send nothing.
 */
export function MetricsRoutePing() {
  const pathname = usePathname();
  useEffect(() => {
    const route = classifyRoute(pathname || "/");
    if (route) pingRouteView(route);
  }, [pathname]);
  return null;
}
