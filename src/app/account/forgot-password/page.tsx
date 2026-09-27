"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { KeyRound, MailCheck, RefreshCw } from "lucide-react";
import { AppHeader, PageContainer } from "@/components/shell/app-shell";
import { TurnstileWidget, type TurnstileConfigurationStatus } from "@/components/account/turnstile-widget";
import { useLanguage } from "@/hooks/use-local-storage";
import { AccountApiError, getAccountCapabilities, requestPasswordReset } from "@/lib/account";
import { SITE_URL } from "@/lib/site-config";

const CAPABILITY_RETRY_DELAYS = [0, 500, 1_500] as const;

async function loadAccountCapabilitiesWithRetry() {
  let lastError: unknown;
  for (const delay of CAPABILITY_RETRY_DELAYS) {
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
    try {
      return await getAccountCapabilities();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("ACCOUNT_CAPABILITIES_UNAVAILABLE");
}

function readableError(error: unknown, language: "zh" | "en") {
  const message = error instanceof Error ? error.message : "";
  const code = error instanceof AccountApiError ? error.code ?? "" : "";
  const normalized = `${code} ${message}`.toUpperCase().replaceAll(" ", "_");
  if (normalized.includes("PASSWORD_RESET_UNAVAILABLE")) return language === "zh" ? "找回密码服务暂不可用，请稍后再试。" : "Password recovery is temporarily unavailable. Try again later.";
  if (normalized.includes("RESET_PASSWORD_DELIVERY_FAILED") || normalized.includes("RESET_PASSWORD") || normalized.includes("EMAIL_DELIVERY")) return language === "zh" ? "重置邮件暂时无法发送，请稍后重试。" : "The reset email could not be sent. Try again later.";
  if (normalized.includes("RATE_LIMIT") || normalized.includes("TOO_MANY_REQUESTS")) return language === "zh" ? "操作过于频繁，请稍后再试。" : "Too many attempts. Please try again later.";
  if (normalized.includes("MISSING_RESPONSE") || normalized.includes("CAPTCHA") || normalized.includes("VERIFICATION_FAILED")) return language === "zh" ? "请完成人机验证后再继续。" : "Complete human verification before continuing.";
  return message || (language === "zh" ? "操作失败，请稍后重试。" : "The request failed. Please try again.");
}

export default function ForgotPasswordPage() {
  const { language } = useLanguage();
  const zh = language === "zh";
  const [email, setEmail] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const [captchaConfigurationStatus, setCaptchaConfigurationStatus] = useState<TurnstileConfigurationStatus>("loading");
  const [passwordResetAvailable, setPasswordResetAvailable] = useState<boolean | null>(null);
  const [authHostAllowed, setAuthHostAllowed] = useState<boolean | null>(null);
  const [capabilitiesError, setCapabilitiesError] = useState(false);
  const [capabilityRetry, setCapabilityRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let active = true;
    void loadAccountCapabilitiesWithRetry().then((capabilities) => {
      if (!active) return;
      setCapabilitiesError(false);
      setPasswordResetAvailable(capabilities.passwordResetAvailable);
      setAuthHostAllowed(capabilities.hostAllowed);
    }).catch(() => {
      if (!active) return;
      setCapabilitiesError(true);
    });
    return () => { active = false; };
  }, [capabilityRetry]);

  const retryCapabilities = () => {
    setCapabilitiesError(false);
    setPasswordResetAvailable(null);
    setAuthHostAllowed(null);
    setCapabilityRetry((value) => value + 1);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback("");
    if (passwordResetAvailable !== true) {
      setFeedback(passwordResetAvailable === null
        ? (zh ? "正在检查找回密码服务，请稍候。" : "Checking password recovery. Please wait.")
        : (zh ? "找回密码服务暂不可用，请稍后再试。" : "Password recovery is not available yet. Try again later."));
      return;
    }
    if (captchaConfigurationStatus !== "ready" || !captchaToken) {
      setFeedback(captchaConfigurationStatus === "unavailable"
        ? (zh ? "人机验证尚未配置，当前无法继续。" : "Human verification is not configured, so this action is unavailable.")
        : captchaConfigurationStatus === "error"
          ? (zh ? "人机验证加载失败，请点击重试后再继续。" : "Human verification failed to load. Retry it before continuing.")
          : (zh ? "请完成人机验证后再继续。" : "Complete human verification before continuing."));
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset({ email: email.trim(), captchaToken, redirectTo: "/account/reset-password/" });
      setSubmitted(true);
    } catch (error) {
      setFeedback(readableError(error, language));
      setCaptchaToken("");
      setCaptchaResetSignal((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="atlas-page min-h-screen">
      <AppHeader backHref="/account/" backLabel={zh ? "返回账号" : "Back to account"} section={zh ? "账号" : "Account"} />
      <PageContainer className="max-w-3xl">
        <div className="max-w-2xl">
          <h1 className="atlas-section-title">{zh ? "找回密码" : "Recover your password"}</h1>
          <p className="mt-4 text-base leading-7 text-ink/60 dark:text-white/60">{zh ? "输入注册邮箱，我们会发送一封包含重置链接的邮件。链接 30 分钟内有效，且只能使用一次。" : "Enter the registered email and we will send a message with a reset link. The link expires in 30 minutes and can be used only once."}</p>
        </div>

        {submitted ? <section className="mt-12 border-y border-ink/12 py-10 dark:border-white/12" aria-live="polite">
          <MailCheck className="size-7 text-accent" aria-hidden="true" />
          <h2 className="mt-4 text-2xl font-semibold">{zh ? "请求已提交" : "Request submitted"}</h2>
          <p className="mt-3 text-sm leading-6 text-ink/55 dark:text-white/55">{zh ? "如果该邮箱已注册，你会收到一封包含重置链接的邮件。为防止滥用，这里不会确认邮箱是否存在。" : "If the address is registered, you will receive an email with a reset link. We never confirm whether an address exists."}</p>
          <Link href="/account/" className="atlas-secondary-action mt-6 justify-center">{zh ? "返回登录" : "Back to sign in"}</Link>
        </section> : <form onSubmit={submit} className="mt-12 space-y-4 border-y border-ink/12 py-8 dark:border-white/12">
          <label className="block text-sm font-semibold">
            <span>{zh ? "邮箱" : "Email"}</span>
            <input aria-label={zh ? "邮箱" : "Email"} value={email} onChange={(event) => setEmail(event.target.value)} name="email" type="email" autoComplete="email" required className="atlas-account-input mt-2" />
          </label>
          {capabilitiesError && <div className="space-y-3" role="alert">
            <p className="text-sm leading-6 text-[color:var(--danger)]">{zh ? "暂时无法检查账号服务状态，请重试。" : "Account services could not be checked. Please retry."}</p>
            <button type="button" onClick={retryCapabilities} className="atlas-secondary-action justify-center">
              <RefreshCw className="size-4" aria-hidden="true" />
              {zh ? "重试" : "Retry"}
            </button>
          </div>}
          {passwordResetAvailable === null && !capabilitiesError && <p className="text-sm text-ink/55 dark:text-white/55" role="status">{zh ? "正在检查找回密码服务…" : "Checking password recovery availability…"}</p>}
          {passwordResetAvailable === false && (authHostAllowed === false ? <div className="space-y-3" role="alert">
            <p className="text-sm leading-6 text-[color:var(--danger)]">{zh ? "当前域名不支持找回密码，请使用主站。" : "Password recovery is not available on this domain. Use the main site instead."}</p>
            <a href={`${SITE_URL}/account/forgot-password/`} className="atlas-secondary-action justify-center">{zh ? "打开主站找回密码" : "Open the main site"}</a>
          </div> : <p className="text-sm text-[color:var(--danger)]" role="alert">{zh ? "找回密码服务暂不可用，请稍后再试。" : "Password recovery is not available yet. Try again later."}</p>)}
          {passwordResetAvailable === true && <TurnstileWidget action="password_reset" language={language} resetSignal={captchaResetSignal} onConfigurationChange={setCaptchaConfigurationStatus} onTokenChange={setCaptchaToken} />}
          <button type="submit" disabled={busy || passwordResetAvailable !== true || captchaConfigurationStatus !== "ready" || !captchaToken} className="atlas-primary-action w-full justify-center disabled:cursor-not-allowed disabled:opacity-45">
            <KeyRound className="size-4" aria-hidden="true" />
            {busy ? (zh ? "请稍候…" : "Please wait…") : (zh ? "发送重置邮件" : "Send reset email")}
          </button>
          {feedback && <p className="text-sm text-[color:var(--danger)]" role="alert">{feedback}</p>}
          <Link href="/account/" className="atlas-text-link justify-start font-semibold">{zh ? "返回登录" : "Back to sign in"}</Link>
        </form>}
        <p className="mt-10 text-sm text-ink/45 dark:text-white/45"><Link href="/privacy/" className="atlas-text-link justify-start font-semibold">{zh ? "查看隐私说明" : "Read privacy notes"}</Link></p>
      </PageContainer>
    </div>
  );
}
