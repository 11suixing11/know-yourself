"use client";

import { useEffect, useId, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const SCRIPT_ID = "cloudflare-turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(container: HTMLElement, options: {
    sitekey: string;
    action?: string;
    theme: "auto";
    language: "zh-cn" | "en";
    appearance: "always";
    callback(token: string): void;
    "expired-callback"(): void;
    "error-callback"(): void;
  }): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScriptPromise: Promise<void> | null = null;
const SCRIPT_TIMEOUT_MS = 15_000;

export interface TurnstileWidgetProps {
  action?: string;
  language?: "zh" | "en";
  resetSignal?: number;
  className?: string;
  onConfigurationChange?(status: TurnstileConfigurationStatus): void;
  onTokenChange(token: string): void;
}

export type TurnstileConfigurationStatus = "loading" | "ready" | "unavailable" | "error";

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;

  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeoutId);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      // Remove a failed script so a later retry can start a new request.
      if (!window.turnstile && script.parentNode) script.parentNode.removeChild(script);
      reject(new Error("TURNSTILE_SCRIPT_FAILED"));
    };
    const checkReady = () => {
      if (window.turnstile) {
        succeed();
        return;
      }
      if (!settled) window.setTimeout(checkReady, 50);
    };
    const timeoutId = window.setTimeout(fail, SCRIPT_TIMEOUT_MS);

    script.addEventListener("error", fail, { once: true });
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    checkReady();
  });

  turnstileScriptPromise = promise.catch((error) => {
    turnstileScriptPromise = null;
    throw error;
  });
  return turnstileScriptPromise;
}

export function TurnstileWidget({
  action,
  language = "zh",
  resetSignal = 0,
  className,
  onConfigurationChange,
  onTokenChange,
}: TurnstileWidgetProps) {
  const reactId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const callbackRef = useRef(onTokenChange);
  const [failed, setFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [runtimeSiteKey, setRuntimeSiteKey] = useState("");
  const [configurationLoaded, setConfigurationLoaded] = useState(false);
  const [configurationFailed, setConfigurationFailed] = useState(false);
  const [configurationRetryNonce, setConfigurationRetryNonce] = useState(0);
  const configurationStatus: TurnstileConfigurationStatus = !configurationLoaded
    ? "loading"
    : configurationFailed || failed
      ? "error"
      : runtimeSiteKey ? "ready" : "unavailable";

  useEffect(() => {
    callbackRef.current = onTokenChange;
  }, [onTokenChange]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/config/turnstile", { cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("TURNSTILE_CONFIG_FAILED");
        return response.json() as Promise<{ siteKey?: string | null }>;
      })
      .then((payload) => {
        if (!cancelled) setRuntimeSiteKey(typeof payload.siteKey === "string" ? payload.siteKey.trim() : "");
      })
      .catch(() => {
        if (!cancelled) {
          setRuntimeSiteKey("");
          setConfigurationFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setConfigurationLoaded(true);
      });
    return () => { cancelled = true; };
  }, [configurationRetryNonce]);

  useEffect(() => {
    onConfigurationChange?.(configurationStatus);
  }, [configurationStatus, onConfigurationChange]);

  useEffect(() => {
    if (!runtimeSiteKey || !containerRef.current) return;
    let cancelled = false;
    setFailed(false);
    void loadTurnstileScript().then(() => {
      if (cancelled || !window.turnstile || !containerRef.current) return;
      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: runtimeSiteKey,
          action,
          theme: "auto",
          language: language === "zh" ? "zh-cn" : "en",
          appearance: "always",
          callback: (token) => callbackRef.current(token),
          "expired-callback": () => callbackRef.current(""),
          "error-callback": () => {
            callbackRef.current("");
            setFailed(true);
          },
        });
      } catch {
        callbackRef.current("");
        setFailed(true);
      }
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      const widgetId = widgetIdRef.current;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      widgetIdRef.current = null;
      callbackRef.current("");
    };
  }, [action, language, retryNonce, runtimeSiteKey]);

  useEffect(() => {
    const widgetId = widgetIdRef.current;
    if (!widgetId || !window.turnstile) return;
    window.turnstile.reset(widgetId);
    callbackRef.current("");
  }, [resetSignal, runtimeSiteKey]);

  if (configurationStatus === "loading") {
    return <p className={cn("text-sm text-ink/55 dark:text-white/55", className)} role="status">
      {language === "zh" ? "正在加载人机验证…" : "Loading human verification…"}
    </p>;
  }

  if (configurationStatus === "unavailable") {
    return <p className={cn("text-sm text-[color:var(--danger)]", className)} role="alert">
      {language === "zh" ? "人机验证尚未配置，当前无法继续。" : "Human verification is not configured, so this action is unavailable."}
    </p>;
  }

  if (configurationFailed) {
    return <div className={className}>
      <p className="text-sm text-[color:var(--danger)]" role="alert">
        {language === "zh" ? "人机验证配置加载失败，请重试。" : "Human verification configuration failed to load. Please retry."}
      </p>
      <button type="button" onClick={() => {
        setConfigurationLoaded(false);
        setConfigurationFailed(false);
        setConfigurationRetryNonce((value) => value + 1);
      }} className="atlas-secondary-action mt-3 justify-center">
        <RefreshCw className="size-4" aria-hidden="true" />
        {language === "zh" ? "重试人机验证" : "Retry verification"}
      </button>
    </div>;
  }

  return <div className={className}>
    <div
      ref={containerRef}
      id={`turnstile-${reactId.replaceAll(":", "")}`}
      aria-label={language === "zh" ? "人机验证" : "Human verification"}
    />
    {failed && <p className="mt-2 text-sm text-[color:var(--danger)]" role="alert">
      {language === "zh" ? "验证加载失败，请重试。" : "Verification failed to load. Please retry."}
    </p>}
    {failed && <button type="button" onClick={() => { setFailed(false); setRetryNonce((value) => value + 1); }} className="atlas-secondary-action mt-3 justify-center">
      <RefreshCw className="size-4" aria-hidden="true" />
      {language === "zh" ? "重试人机验证" : "Retry verification"}
    </button>}
  </div>;
}
