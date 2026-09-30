"use client";

import { useEffect, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  KeyRound,
  LogIn,
  LogOut,
  MailCheck,
  RefreshCw,
  Settings,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { useAccountIdentity, useAccountSync, useAccountActions } from "@/components/account/account-provider";
import { ProfileEditor } from "@/components/account/profile-editor";
import { AppHeader, PageContainer } from "@/components/shell/app-shell";
import type { TurnstileConfigurationStatus } from "@/components/account/turnstile-widget";
/** Only registration renders a captcha, so only registration pays for it. */
const TurnstileWidget = dynamic(() => import("@/components/account/turnstile-widget").then((mod) => mod.TurnstileWidget), { ssr: false });
import { useLanguage } from "@/hooks/use-local-storage";
import { AccountApiError, changePassword, deleteAccount, getAccountCapabilities, loginAccount, registerAccount, sendVerificationEmail } from "@/lib/account";
import { clearSyncBaseline } from "@/lib/account-sync";
import { clearLocalProfile } from "@/lib/local-profile";
import { adoptSnapshotAsGuest, readSnapshot } from "@/lib/storage";
import { SITE_URL } from "@/lib/site-config";
import { cn } from "@/lib/utils";

type AuthMode = "login" | "register";
type PasswordFeedback = { tone: "success" | "error"; message: string } | null;
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
  if (normalized.includes("INVALID_EMAIL_OR_PASSWORD")) return language === "zh" ? "邮箱或密码不正确。" : "The email or password is incorrect.";
  if (normalized.includes("USER_ALREADY_EXISTS")) return language === "zh" ? "这个邮箱已经注册，可以直接登录。" : "This email is already registered. Sign in instead.";
  if (normalized.includes("PASSWORD_TOO_SHORT")) return language === "zh" ? "密码至少需要 10 个字符。" : "Use at least 10 characters for your password.";
  if (normalized.includes("PASSWORD_TOO_LONG")) return language === "zh" ? "密码不能超过 128 个字符。" : "Use no more than 128 characters for your password.";
  if (normalized.includes("INVALID_PASSWORD")) return language === "zh" ? "密码不正确。" : "The password is incorrect.";
  if (normalized.includes("RATE_LIMIT") || normalized.includes("TOO_MANY_REQUESTS")) return language === "zh" ? "操作过于频繁，请稍后再试。" : "Too many attempts. Please try again later.";
  if (normalized.includes("UNAUTHORIZED") || normalized.includes("NOT_AUTHENTICATED") || normalized.includes("FAILED_TO_GET_SESSION")) return language === "zh" ? "登录状态已失效，请重新登录。" : "Your session has expired. Please sign in again.";
  if (normalized.includes("INVALID_NAME")) return language === "zh" ? "显示名称需要为 1 至 80 个字符。" : "Use 1 to 80 characters for your display name.";
  if (normalized.includes("EMAIL_NOT_VERIFIED")) return language === "zh" ? "请先完成邮箱验证。" : "Verify your email before signing in.";
  if (normalized.includes("MISSING_RESPONSE") || normalized.includes("CAPTCHA")) return language === "zh" ? "请完成人机验证后再继续。" : "Complete human verification before continuing.";
  if (normalized.includes("REGISTRATION_UNAVAILABLE")) return language === "zh" ? "注册服务暂未开放，请稍后再试。" : "Registration is not available yet. Try again later.";
  if (normalized.includes("EMAIL_VERIFICATION_UNAVAILABLE")) return language === "zh" ? "验证邮件服务暂不可用，请稍后再试。" : "Email verification is temporarily unavailable. Try again later.";
  if (normalized.includes("VERIFICATION_EMAIL") || normalized.includes("EMAIL_DELIVERY")) return language === "zh" ? "验证邮件暂时无法发送，请稍后重试。" : "The verification email could not be sent. Try again later.";
  return message || (language === "zh" ? "操作失败，请稍后重试。" : "The request failed. Please try again.");
}

export default function AccountPage() {
  const { language } = useLanguage();
  const { user } = useAccountIdentity();
  const { syncState, syncError, syncChoice } = useAccountSync();
  const { refreshAccount, syncNow, signOut } = useAccountActions();
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordFeedback, setPasswordFeedback] = useState<PasswordFeedback>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [action, setAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [feedbackTone, setFeedbackTone] = useState<"success" | "error">("error");
  const [needsVerification, setNeedsVerification] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
  const [captchaConfigurationStatus, setCaptchaConfigurationStatus] = useState<TurnstileConfigurationStatus>("loading");
  const [confirmAccountDelete, setConfirmAccountDelete] = useState(false);
  const [emailVerificationAvailable, setEmailVerificationAvailable] = useState<boolean | null>(null);
  const [registrationAvailable, setRegistrationAvailable] = useState<boolean | null>(null);
  const [authHostAllowed, setAuthHostAllowed] = useState<boolean | null>(null);
  const [capabilitiesError, setCapabilitiesError] = useState(false);
  const [capabilityRetry, setCapabilityRetry] = useState(0);

  const zh = language === "zh";
  const busy = action !== null;
  const cloudSyncEnabled = Boolean(user && syncChoice === "merge");

  useEffect(() => {
    let active = true;
    void loadAccountCapabilitiesWithRetry().then((capabilities) => {
      if (!active) return;
      setCapabilitiesError(false);
      setEmailVerificationAvailable(capabilities.emailVerificationAvailable);
      setRegistrationAvailable(capabilities.registrationAvailable);
      setAuthHostAllowed(capabilities.hostAllowed);
    }).catch(() => {
      if (!active) return;
      setCapabilitiesError(true);
    });
    return () => { active = false; };
  }, [capabilityRetry]);

  const retryCapabilities = () => {
    setCapabilitiesError(false);
    setEmailVerificationAvailable(null);
    setRegistrationAvailable(null);
    setAuthHostAllowed(null);
    setCapabilityRetry((value) => value + 1);
  };

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback("");
    setNeedsVerification(false);
    if (password.length < 10) {
      setFeedback(zh ? "密码至少需要 10 个字符。" : "Use at least 10 characters for your password.");
      return;
    }
    if (authMode === "register" && !displayName.trim()) {
      setFeedback(zh ? "请输入显示名称。" : "Enter a display name.");
      return;
    }
    if (authMode === "register" && registrationAvailable !== true) {
      setFeedback(registrationAvailable === null
        ? (zh ? "正在检查注册服务，请稍候。" : "Checking registration availability. Please wait.")
        : (zh ? "注册服务暂未开放，请稍后再试。" : "Registration is not available yet. Try again later."));
      setFeedbackTone("error");
      return;
    }
    if (authMode === "register" && (captchaConfigurationStatus !== "ready" || !captchaToken)) {
      setFeedback(captchaConfigurationStatus === "unavailable"
        ? (zh ? "人机验证尚未配置，当前无法注册。" : "Human verification is not configured, so registration is unavailable.")
        : captchaConfigurationStatus === "error"
          ? (zh ? "人机验证加载失败，请点击重试后再继续。" : "Human verification failed to load. Retry it before continuing.")
        : (zh ? "请完成人机验证后再继续。" : "Complete human verification before continuing."));
      setFeedbackTone("error");
      return;
    }
    setAction("auth");
    try {
      if (authMode === "register") {
        const targetEmail = email.trim();
        await registerAccount({ email: targetEmail, password, displayName: displayName.trim(), captchaToken });
        setPassword("");
        setCaptchaToken("");
        setCaptchaResetSignal((value) => value + 1);
        setAuthMode("login");
        setNeedsVerification(true);
        try {
          await sendVerificationEmail(targetEmail);
          setFeedbackTone("success");
          setFeedback(zh ? "注册请求已处理。若邮箱需要验证，你会收到验证邮件。" : "Registration request processed. If the address needs verification, a message will be sent.");
        } catch {
          setFeedbackTone("error");
          setFeedback(zh ? "注册请求已处理，但验证邮件发送失败。请稍后使用下方按钮重试。" : "The registration request was processed, but the verification email could not be sent. Retry below later.");
        }
        return;
      } else {
        await loginAccount({ email: email.trim(), password });
      }
      setPassword("");
      await refreshAccount();
    } catch (error) {
      const message = readableError(error, language);
      setFeedbackTone("error");
      setFeedback(message);
      const normalized = error instanceof AccountApiError
        ? `${error.code ?? ""} ${error.message}`.toUpperCase().replaceAll(" ", "_")
        : error instanceof Error ? error.message.toUpperCase().replaceAll(" ", "_") : "";
      setNeedsVerification(normalized.includes("EMAIL_NOT_VERIFIED"));
      if (authMode === "register") {
        setCaptchaToken("");
        setCaptchaResetSignal((value) => value + 1);
      }
    } finally {
      setAction(null);
    }
  };

  const resendVerification = async () => {
    const targetEmail = user?.email ?? email.trim();
    if (!targetEmail) return;
    if (emailVerificationAvailable !== true) {
      setFeedbackTone("error");
      setFeedback(emailVerificationAvailable === null
        ? (zh ? "正在检查邮件服务，请稍候。" : "Checking email delivery. Please wait.")
        : (zh ? "验证邮件服务暂不可用，请稍后再试。" : "Email verification is temporarily unavailable. Try again later."));
      return;
    }
    setAction("verify-email");
    setFeedback("");
    try {
      await sendVerificationEmail(targetEmail);
      setFeedbackTone("success");
      setFeedback(zh ? "验证邮件已重新发送，请检查收件箱。" : "Verification email sent. Check your inbox.");
      setNeedsVerification(true);
    } catch (error) {
      setFeedbackTone("error");
      setFeedback(readableError(error, language));
    } finally {
      setAction(null);
    }
  };

  const updatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordFeedback(null);
    if (newPassword.length < 10) {
      setPasswordFeedback({ tone: "error", message: zh ? "新密码至少需要 10 个字符。" : "Use at least 10 characters for your new password." });
      return;
    }
    if (newPassword.length > 128) {
      setPasswordFeedback({ tone: "error", message: zh ? "新密码不能超过 128 个字符。" : "Use no more than 128 characters for your new password." });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordFeedback({ tone: "error", message: zh ? "两次输入的新密码不一致。" : "The new passwords do not match." });
      return;
    }
    setAction("change-password");
    try {
      await changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setPasswordFeedback({
        tone: "success",
        message: zh ? "密码已修改。当前设备保持登录，其他设备已退出登录。" : "Password changed. This device remains signed in; other devices have been signed out.",
      });
    } catch (error) {
      setPasswordFeedback({ tone: "error", message: readableError(error, language) });
    } finally {
      setAction(null);
    }
  };

  const removeAccount = async () => {
    if (!user) return;
    if (!confirmAccountDelete) {
      setConfirmAccountDelete(true);
      return;
    }
    if (!deletePassword) {
      setFeedback(zh ? "请输入当前密码以确认删除。" : "Enter your current password to confirm deletion.");
      return;
    }
    setFeedback("");
    setAction("delete-account");
    try {
      const localCopy = readSnapshot();
      const deletedUserId = user.id;
      await deleteAccount(deletePassword);
      clearSyncBaseline(deletedUserId);
      clearLocalProfile(deletedUserId);
      adoptSnapshotAsGuest(localCopy, deletedUserId);
      setDeletePassword("");
      setConfirmAccountDelete(false);
      await refreshAccount();
      setFeedback(zh ? "账号和云端资料已删除，本机测评数据已转为游客副本。" : "The account and cloud profile were deleted. Assessment data on this device now remains as a guest copy.");
    } catch (error) {
      setFeedback(readableError(error, language));
    } finally {
      setAction(null);
    }
  };

  if (syncState === "loading") {
    return <div className="atlas-page min-h-screen"><AppHeader backHref="/" backLabel={zh ? "返回首页" : "Back home"} /><main id="main-content" tabIndex={-1} className="atlas-loading" aria-busy="true"><span className="atlas-loading-orbit" aria-hidden="true" /><p>{zh ? "正在读取账号状态…" : "Loading account…"}</p></main></div>;
  }

  return (
    <div className="atlas-page min-h-screen">
      <AppHeader backHref="/" backLabel={zh ? "返回首页" : "Back home"} section={zh ? "账号" : "Account"} />
      <PageContainer className="max-w-3xl">
        <div className="max-w-2xl">
          <h1 className="atlas-section-title">{zh ? "账号与同步" : "Account and sync"}</h1>
          <p className="mt-4 text-base leading-7 text-ink/60 dark:text-white/60">{zh ? "游客数据默认留在本机。登录后，本机与云端数据会自动合并并在设备之间同步——你答过的每一次测评都跟着你。" : "Guest data stays on this device by default. After signing in, device and cloud data merge automatically and stay synced across devices — your assessment history follows you."}</p>
          <Link href="/settings/" className="atlas-secondary-action mt-6 justify-center">
            <Settings className="size-4" aria-hidden="true" />
            {zh ? "数据与偏好设置" : "Data and preferences"}
          </Link>
        </div>

        {!user ? (
          <section className="mt-12 border-y border-ink/12 py-8 dark:border-white/12" aria-labelledby="auth-heading">
            <div className="grid gap-8 md:grid-cols-[0.8fr_1.2fr]">
              <div>
                <h2 id="auth-heading" className="text-2xl font-semibold">{authMode === "login" ? (zh ? "登录" : "Sign in") : (zh ? "创建账号" : "Create account")}</h2>
                <p className="mt-3 text-sm leading-6 text-ink/55 dark:text-white/55">{zh ? "一个账号，跨设备接续你的测评与草稿。登录后本机数据自动并入云端，不会丢失。" : "One account picks up your assessments and drafts across devices. Local data merges into the cloud after signing in and is never lost."}</p>
                <div className="mt-6 inline-grid grid-cols-2 rounded-lg border border-ink/12 p-1 dark:border-white/12" role="tablist" aria-label={zh ? "账号操作" : "Account action"}>
                  <button type="button" role="tab" aria-selected={authMode === "login"} onClick={() => { setAuthMode("login"); setFeedback(""); setNeedsVerification(false); }} className={cn("min-h-10 rounded-md px-4 text-sm font-semibold", authMode === "login" ? "bg-ink text-paper" : "text-ink/55 dark:text-white/55")}>{zh ? "登录" : "Sign in"}</button>
                  <button type="button" role="tab" aria-selected={authMode === "register"} onClick={() => { setAuthMode("register"); setFeedback(""); setNeedsVerification(false); setCaptchaToken(""); setCaptchaConfigurationStatus("loading"); setCaptchaResetSignal((value) => value + 1); }} className={cn("min-h-10 rounded-md px-4 text-sm font-semibold", authMode === "register" ? "bg-ink text-paper" : "text-ink/55 dark:text-white/55")}>{zh ? "注册" : "Register"}</button>
                </div>
              </div>

              <form onSubmit={submitAuth} className="space-y-4">
                {authMode === "register" && <label className="block text-sm font-semibold"><span>{zh ? "显示名称" : "Display name"}</span><input aria-label={zh ? "显示名称" : "Display name"} value={displayName} onChange={(event) => setDisplayName(event.target.value)} name="name" autoComplete="name" maxLength={80} required className="atlas-account-input mt-2" /></label>}
                <label className="block text-sm font-semibold"><span>{zh ? "邮箱" : "Email"}</span><input aria-label={zh ? "邮箱" : "Email"} value={email} onChange={(event) => setEmail(event.target.value)} name="email" type="email" autoComplete="email" required className="atlas-account-input mt-2" /></label>
                <label className="block text-sm font-semibold"><span>{zh ? "密码" : "Password"}</span><input aria-label={zh ? "密码" : "Password"} value={password} onChange={(event) => setPassword(event.target.value)} name="password" type="password" minLength={10} maxLength={128} autoComplete={authMode === "login" ? "current-password" : "new-password"} required className="atlas-account-input mt-2" /><span className="mt-2 block text-xs font-normal text-ink/45 dark:text-white/45">{zh ? "至少 10 个字符" : "At least 10 characters"}</span></label>
                {authMode === "register" && capabilitiesError && <div className="space-y-3" role="alert">
                  <p className="text-sm leading-6 text-[color:var(--danger)]">{zh ? "暂时无法检查账号服务状态，请重试。" : "Account services could not be checked. Please retry."}</p>
                  <button type="button" onClick={retryCapabilities} className="atlas-secondary-action justify-center">
                    <RefreshCw className="size-4" aria-hidden="true" />
                    {zh ? "重试" : "Retry"}
                  </button>
                </div>}
                {authMode === "register" && registrationAvailable === null && !capabilitiesError && <p className="text-sm text-ink/55 dark:text-white/55" role="status">{zh ? "正在检查注册服务…" : "Checking registration availability…"}</p>}
                {authMode === "register" && registrationAvailable === false && (authHostAllowed === false ? <div className="space-y-3" role="alert">
                  <p className="text-sm leading-6 text-[color:var(--danger)]">{zh ? "当前域名不支持注册，请使用主站。" : "Registration is not available on this domain. Use the main site instead."}</p>
                  <a href={`${SITE_URL}/account/`} className="atlas-secondary-action justify-center">{zh ? "打开主站注册" : "Open the main site"}</a>
                </div> : <p className="text-sm text-[color:var(--danger)]" role="alert">{zh ? "注册服务暂未开放，请稍后再试。" : "Registration is not available yet. Try again later."}</p>)}
                {authMode === "register" && registrationAvailable === true && <TurnstileWidget action="signup" language={language} resetSignal={captchaResetSignal} onConfigurationChange={setCaptchaConfigurationStatus} onTokenChange={setCaptchaToken} />}
                <button type="submit" disabled={busy || (authMode === "register" && (registrationAvailable !== true || captchaConfigurationStatus !== "ready" || !captchaToken))} className="atlas-primary-action w-full justify-center disabled:cursor-not-allowed disabled:opacity-45">{authMode === "login" ? <LogIn className="size-4" aria-hidden="true" /> : <UserPlus className="size-4" aria-hidden="true" />}                {action === "auth" ? (zh ? "请稍候…" : "Please wait…") : authMode === "login" ? (zh ? "登录" : "Sign in") : (zh ? "创建账号" : "Create account")}</button>
                {authMode === "login" && <Link href="/account/forgot-password/" className="atlas-text-link justify-start font-semibold">{zh ? "忘记密码？" : "Forgot password?"}</Link>}
                {needsVerification && <button type="button" onClick={() => void resendVerification()} disabled={busy || !email.trim() || emailVerificationAvailable !== true} className="atlas-secondary-action w-full justify-center disabled:opacity-45"><MailCheck className="size-4" aria-hidden="true" />{action === "verify-email" ? (zh ? "正在发送…" : "Sending…") : (zh ? "重新发送验证邮件" : "Resend verification email")}</button>}
              </form>
            </div>
          </section>
        ) : (
          <>
            <ProfileEditor key={user.id} userId={user.id} displayName={user.displayName} email={user.email} zh={zh} syncMode="merge" />

            {!user.emailVerified && <section className="atlas-settings-section mt-10" aria-labelledby="verify-email-heading">
              <h2 id="verify-email-heading" className="text-xl font-semibold">{zh ? "验证邮箱" : "Verify email"}</h2>
              <p className="mt-2 text-sm leading-6 text-ink/55 dark:text-white/55">{zh ? "完成邮箱验证后才能上传图片和公开札记。" : "Email verification is required before uploading images or publishing journals."}</p>
              {capabilitiesError && <div className="mt-3 space-y-3" role="alert">
                <p className="text-sm leading-6 text-[color:var(--danger)]">{zh ? "暂时无法检查验证邮件服务，请重试。" : "Email verification service could not be checked. Please retry."}</p>
                <button type="button" onClick={retryCapabilities} className="atlas-secondary-action justify-center"><RefreshCw className="size-4" aria-hidden="true" />{zh ? "重试" : "Retry"}</button>
              </div>}
              {emailVerificationAvailable === false && <p className="mt-3 text-sm text-[color:var(--danger)]" role="alert">{zh ? "验证邮件服务暂不可用，请稍后再试。" : "Email verification is temporarily unavailable. Try again later."}</p>}
              <button type="button" onClick={() => void resendVerification()} disabled={busy || emailVerificationAvailable !== true} className="atlas-secondary-action mt-5 justify-center disabled:opacity-45"><MailCheck className="size-4" aria-hidden="true" />{action === "verify-email" ? (zh ? "正在发送…" : "Sending…") : (zh ? "发送验证邮件" : "Send verification email")}</button>
            </section>}

            <section className="atlas-settings-section mt-10" aria-labelledby="sync-heading">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="sync-heading" className="text-2xl font-semibold">{zh ? "自动同步" : "Automatic sync"}</h2>
                <div className="flex items-center gap-2 text-xs font-semibold text-ink/55 dark:text-white/55"><span className={cn("size-2 rounded-full", syncState === "ready" ? "bg-accent" : syncState === "error" ? "bg-[var(--danger)]" : "bg-ink/25 dark:bg-white/25")} aria-hidden="true" /><span>{syncState === "ready" ? (zh ? "同步已开启" : "Sync on") : syncState === "syncing" ? (zh ? "正在同步" : "Syncing") : (zh ? "需要处理" : "Needs attention")}</span></div>
              </div>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-ink/55 dark:text-white/55">{zh ? "登录后会自动合并本机与云端的结果、收藏、偏好、未完成进度和个人资料；已完成测评的原始答案只留在本机。" : "After signing in, device and cloud results, bookmarks, preferences, unfinished progress, and profile are merged automatically. Completed raw answers stay on this device."}</p>
              {(syncError || (feedback && !confirmAccountDelete)) && <p className={cn("mt-4 text-sm leading-6", syncError ? "text-[color:var(--danger)]" : "text-accent")} role={syncError ? "alert" : "status"}>{syncError || feedback}</p>}
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                {cloudSyncEnabled && <button type="button" onClick={() => void syncNow()} disabled={busy || syncState === "syncing"} className="atlas-secondary-action justify-center disabled:opacity-45"><RefreshCw className={cn("size-4", syncState === "syncing" && "animate-spin")} aria-hidden="true" />{zh ? "立即同步" : "Sync now"}</button>}
                <button type="button" onClick={() => void signOut()} disabled={busy} className="atlas-secondary-action justify-center disabled:opacity-45"><LogOut className="size-4" aria-hidden="true" />{zh ? "退出登录" : "Sign out"}</button>
              </div>
            </section>

            <section className="atlas-settings-section mt-10" aria-labelledby="password-heading">
              <h2 id="password-heading" className="text-xl font-semibold">{zh ? "账号安全" : "Account security"}</h2>
              <p className="mt-2 text-sm leading-6 text-ink/55 dark:text-white/55">{zh ? "修改密码后，当前设备保持登录，其他设备会退出登录。" : "After changing your password, this device stays signed in and other devices are signed out."}</p>
              <form onSubmit={updatePassword} className="mt-5 max-w-md space-y-4">
                <label className="block text-sm font-semibold">
                  <span>{zh ? "当前密码" : "Current password"}</span>
                  <input aria-label={zh ? "当前密码" : "Current password"} value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setPasswordFeedback(null); }} name="current-password" type="password" autoComplete="current-password" required className="atlas-account-input mt-2" />
                </label>
                <label className="block text-sm font-semibold">
                  <span>{zh ? "新密码" : "New password"}</span>
                  <input aria-label={zh ? "新密码" : "New password"} value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setPasswordFeedback(null); }} name="new-password" type="password" minLength={10} maxLength={128} autoComplete="new-password" required className="atlas-account-input mt-2" />
                  <span className="mt-2 block text-xs font-normal text-ink/45 dark:text-white/45">{zh ? "10 至 128 个字符" : "10 to 128 characters"}</span>
                </label>
                <label className="block text-sm font-semibold">
                  <span>{zh ? "确认新密码" : "Confirm new password"}</span>
                  <input aria-label={zh ? "确认新密码" : "Confirm new password"} value={confirmNewPassword} onChange={(event) => { setConfirmNewPassword(event.target.value); setPasswordFeedback(null); }} name="confirm-new-password" type="password" minLength={10} maxLength={128} autoComplete="new-password" required className="atlas-account-input mt-2" />
                </label>
                <button type="submit" disabled={busy} className="atlas-secondary-action justify-center disabled:cursor-not-allowed disabled:opacity-45">
                  <KeyRound className="size-4" aria-hidden="true" />
                  {action === "change-password" ? (zh ? "正在修改…" : "Changing…") : (zh ? "修改密码" : "Change password")}
                </button>
                {passwordFeedback && <p className={cn("text-sm leading-6", passwordFeedback.tone === "error" ? "text-[color:var(--danger)]" : "text-accent")} role={passwordFeedback.tone === "error" ? "alert" : "status"}>{passwordFeedback.message}</p>}
              </form>
            </section>

            <section className="atlas-settings-section mt-10" aria-labelledby="delete-account-heading">
              <h2 id="delete-account-heading" className="text-xl font-semibold">{zh ? "删除账号" : "Delete account"}</h2>
              <p className="mt-2 text-sm leading-6 text-ink/55 dark:text-white/55">{zh ? "账号、登录会话、全部云端数据和本机个人资料副本会永久删除；这台设备上的测评数据会转为游客副本保留。" : "The account, sessions, all cloud data, and the local profile copy are permanently deleted. Assessment data on this device remains as a guest copy."}</p>
              <div className="mt-5 max-w-md">
                {confirmAccountDelete && <label className="block text-sm font-semibold"><span>{zh ? "当前密码" : "Current password"}</span><input aria-label={zh ? "当前密码" : "Current password"} value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} type="password" autoComplete="current-password" className="atlas-account-input mt-2" /></label>}
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  {confirmAccountDelete && <button type="button" onClick={() => { setConfirmAccountDelete(false); setDeletePassword(""); }} disabled={busy} className="atlas-text-button">{zh ? "取消" : "Cancel"}</button>}
                  <button type="button" onClick={() => void removeAccount()} disabled={busy} className="atlas-danger-action disabled:opacity-45"><ShieldCheck className="size-4" aria-hidden="true" />{action === "delete-account" ? (zh ? "正在删除…" : "Deleting…") : confirmAccountDelete ? (zh ? "确认永久删除" : "Delete permanently") : (zh ? "删除账号" : "Delete account")}</button>
                </div>
                {confirmAccountDelete && feedback && <p className="mt-3 text-sm text-[color:var(--danger)]" role="alert">{feedback}</p>}
              </div>
            </section>
          </>
        )}

        {!user && feedback && <p className={cn("mt-5 text-sm", feedbackTone === "success" ? "text-accent" : "text-[color:var(--danger)]")} role={feedbackTone === "success" ? "status" : "alert"}>{feedback}</p>}
        <p className="mt-10 text-sm text-ink/45 dark:text-white/45"><Link href="/privacy/" className="atlas-text-link justify-start font-semibold">{zh ? "查看隐私说明" : "Read privacy notes"}</Link></p>
      </PageContainer>
    </div>
  );
}
