"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArchiveX, Check, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { useAccountIdentity, useAccountSync } from "@/components/account/account-provider";
import { AppHeader, PageContainer } from "@/components/shell/app-shell";
import { useLanguage } from "@/hooks/use-local-storage";

type AdminTab = "queue" | "complaints" | "accounts" | "audit";
type ContentTargetType = "entry" | "comment" | "community_post" | "community_comment";
type GovernanceStatus = "normal" | "no_upload" | "read_only" | "suspended" | "banned";
type ModerationRow = Record<string, unknown> & { id: string; user_id?: string; report_count?: number; report_reasons?: string };
type ComplaintRow = Record<string, unknown> & { id: string; kind: string; target_url: string; contact?: string; details: string; status: string; created_at: number };
type UserRow = Record<string, unknown> & { id: string; name: string; email: string; emailVerified?: number; governance_status?: GovernanceStatus; governance_reason?: string };
type AuditRow = Record<string, unknown> & { id: string; actor_type: string; action: string; target_type: string; target_id: string; reason?: string; created_at: number };

interface ModerationDashboard {
  entries: ModerationRow[];
  comments: ModerationRow[];
  communityPosts: ModerationRow[];
  communityComments: ModerationRow[];
  complaints: ComplaintRow[];
  users?: UserRow[];
  audit?: AuditRow[];
}

const EMPTY_DASHBOARD: ModerationDashboard = { entries: [], comments: [], communityPosts: [], communityComments: [], complaints: [], users: [], audit: [] };

function formatDate(value: unknown, language: "zh" | "en") {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

function targetLabel(type: ContentTargetType, language: "zh" | "en") {
  const labels = language === "zh"
    ? { entry: "图像札记", comment: "札记留言", community_post: "社区分享", community_comment: "社区留言" }
    : { entry: "Image journal", comment: "Journal response", community_post: "Community share", community_comment: "Community response" };
  return labels[type];
}

function rowText(type: ContentTargetType, row: ModerationRow) {
  if (type === "entry") return String(row.title || row.id);
  if (type === "community_post") return String(row.reflection || row.id);
  return String(row.body || row.id);
}

function ModerationItem({ type, row, language, busy, onAction }: { type: ContentTargetType; row: ModerationRow; language: "zh" | "en"; busy: boolean; onAction: (type: ContentTargetType, id: string, action: "restore" | "remove", reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  return <article className="border-b border-ink/10 py-6 last:border-0 dark:border-white/10">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-accent">{targetLabel(type, language)}</p>
        <h3 className="mt-2 break-words text-base font-semibold">{rowText(type, row)}</h3>
        <p className="mt-2 text-xs leading-5 text-ink/50 dark:text-white/50">ID: {row.id} · {language === "zh" ? `${Number(row.report_count || 0)} 名独立举报者` : `${Number(row.report_count || 0)} independent reporters`}{row.report_reasons ? ` · ${row.report_reasons}` : ""}</p>
      </div>
      <span className="text-xs text-ink/45 dark:text-white/45">{formatDate(row.hidden_at, language)}</span>
    </div>
    <label className="mt-4 block text-xs font-semibold"><span>{language === "zh" ? "处理说明" : "Decision note"}</span><input aria-label={language === "zh" ? "处理说明" : "Decision note"} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} className="atlas-account-input mt-2" /></label>
    <div className="mt-4 flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => void onAction(type, row.id, "restore", reason)} className="atlas-secondary-action disabled:opacity-45"><Check className="size-4" aria-hidden="true" />{language === "zh" ? "恢复" : "Restore"}</button>
      <button type="button" disabled={busy} onClick={() => void onAction(type, row.id, "remove", reason)} className="atlas-danger-action disabled:opacity-45"><ArchiveX className="size-4" aria-hidden="true" />{language === "zh" ? "永久下架" : "Remove"}</button>
    </div>
  </article>;
}

export default function ModerationPage() {
  const { language } = useLanguage();
  const { user } = useAccountIdentity();
  const { syncState } = useAccountSync();
  const [tab, setTab] = useState<AdminTab>("queue");
  const [data, setData] = useState<ModerationDashboard>(EMPTY_DASHBOARD);
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/journal/admin/moderation", { credentials: "include", cache: "no-store", headers: { Accept: "application/json" } });
      const payload = await response.json().catch(() => null) as (ModerationDashboard & { error?: string }) | null;
      if (!response.ok) throw new Error(payload?.error || (language === "zh" ? "无法读取内容治理后台" : "Unable to load moderation"));
      setData({ ...EMPTY_DASHBOARD, ...payload });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (language === "zh" ? "无法读取内容治理后台" : "Unable to load moderation"));
    } finally {
      setLoading(false);
    }
  }, [language, user]);

  useEffect(() => {
    if (syncState === "loading") return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, syncState]);

  const loadUsers = useCallback(async (search: string, signal?: AbortSignal) => {
    if (!user) return;
    setUsersLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("query", search.trim());
      const response = await fetch(`/api/journal/admin/users${params.size ? `?${params}` : ""}`, {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal,
      });
      const payload = await response.json().catch(() => null) as { users?: UserRow[]; error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || (language === "zh" ? "无法搜索账号" : "Unable to search accounts"));
      if (!signal?.aborted) setData((current) => ({ ...current, users: Array.isArray(payload?.users) ? payload.users : [] }));
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : (language === "zh" ? "无法搜索账号" : "Unable to search accounts"));
    } finally {
      if (!signal?.aborted) setUsersLoading(false);
    }
  }, [language, user]);

  useEffect(() => {
    if (tab !== "accounts" || !user) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => { void loadUsers(query, controller.signal); }, query.trim() ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loadUsers, query, tab, user]);

  const mutate = async (url: string, body: unknown) => {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, {
        method: "PATCH",
        credentials: "include",
        headers: { Accept: "application/json", "Content-Type": "application/json", "X-Expected-User-Id": user.id },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || (language === "zh" ? "操作失败" : "Action failed"));
      await load();
      if (tab === "accounts") await loadUsers(query);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (language === "zh" ? "操作失败" : "Action failed"));
    } finally {
      setBusy(false);
    }
  };

  const queue = [
    ...data.entries.map((row) => ({ type: "entry" as const, row })),
    ...data.comments.map((row) => ({ type: "comment" as const, row })),
    ...data.communityPosts.map((row) => ({ type: "community_post" as const, row })),
    ...data.communityComments.map((row) => ({ type: "community_comment" as const, row })),
  ];

  return <div className="atlas-page min-h-screen">
    <AppHeader backHref="/" backLabel={language === "zh" ? "返回首页" : "Back home"} section={language === "zh" ? "内容治理" : "Moderation"} />
    <PageContainer className="max-w-5xl">
      <header className="flex flex-wrap items-end justify-between gap-5 border-b border-ink/12 pb-7 dark:border-white/12">
        <div><p className="text-xs font-semibold text-accent">{language === "zh" ? "运营管理员" : "Operations admin"}</p><h1 className="mt-2 text-3xl font-semibold">{language === "zh" ? "内容治理后台" : "Moderation console"}</h1></div>
        <button type="button" onClick={() => void load()} disabled={loading || busy} className="atlas-secondary-action disabled:opacity-45"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />{language === "zh" ? "刷新" : "Refresh"}</button>
      </header>

      {!user && !loading ? <div className="community-state"><ShieldCheck className="mx-auto size-7" aria-hidden="true" /><h2>{language === "zh" ? "需要管理员账号" : "Admin account required"}</h2><Link href="/account/" className="atlas-primary-action">{language === "zh" ? "登录" : "Sign in"}</Link></div> : <>
        <div className="mt-7 grid grid-cols-4 rounded-lg border border-ink/12 p-1 dark:border-white/12" role="tablist" aria-label={language === "zh" ? "内容治理视图" : "Moderation views"}>
          {(["queue", "complaints", "accounts", "audit"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} className={`min-h-11 rounded-md px-2 text-xs font-semibold sm:text-sm ${tab === item ? "bg-ink text-paper" : "text-ink/55 dark:text-white/55"}`}>{item === "queue" ? (language === "zh" ? `隐藏内容 ${queue.length}` : `Hidden ${queue.length}`) : item === "complaints" ? (language === "zh" ? `投诉 ${data.complaints.length}` : `Complaints ${data.complaints.length}`) : item === "accounts" ? (language === "zh" ? "账号" : "Accounts") : (language === "zh" ? "审计" : "Audit")}</button>)}
        </div>
        {error && <p className="mt-5 text-sm text-[color:var(--danger)]" role="alert">{error}</p>}
        {loading ? <div className="community-state" role="status">{language === "zh" ? "正在读取治理记录…" : "Loading moderation records…"}</div> : <div className="mt-6">
          {tab === "queue" && (queue.length ? queue.map(({ type, row }) => <ModerationItem key={`${type}:${row.id}`} type={type} row={row} language={language} busy={busy} onAction={(targetType, targetId, action, reason) => mutate("/api/journal/admin/moderation", { targetType, targetId, action, reason })} />) : <div className="community-state"><h2>{language === "zh" ? "没有待处理的隐藏内容" : "No hidden content needs review"}</h2></div>)}

          {tab === "complaints" && (data.complaints.length ? data.complaints.map((item) => <article key={item.id} className="border-b border-ink/10 py-6 last:border-0 dark:border-white/10"><div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs font-semibold text-accent">{item.kind === "privacy" ? (language === "zh" ? "隐私" : "Privacy") : (language === "zh" ? "版权" : "Copyright")}</p><h3 className="mt-2 break-all text-sm font-semibold">{item.target_url}</h3></div><time className="text-xs text-ink/45 dark:text-white/45">{formatDate(item.created_at, language)}</time></div><p className="mt-4 whitespace-pre-wrap text-sm leading-6">{item.details}</p>{item.contact && <p className="mt-3 text-xs text-ink/50 dark:text-white/50">{item.contact}</p>}<div className="mt-5 flex flex-wrap gap-3"><button type="button" disabled={busy} className="atlas-secondary-action" onClick={() => void mutate("/api/journal/admin/moderation", { targetType: "complaint", targetId: item.id, action: "reviewing", reason: "" })}>{language === "zh" ? "标记处理中" : "Reviewing"}</button><button type="button" disabled={busy} className="atlas-primary-action" onClick={() => void mutate("/api/journal/admin/moderation", { targetType: "complaint", targetId: item.id, action: "resolved", reason: "" })}>{language === "zh" ? "已解决" : "Resolve"}</button><button type="button" disabled={busy} className="atlas-danger-action" onClick={() => void mutate("/api/journal/admin/moderation", { targetType: "complaint", targetId: item.id, action: "rejected", reason: "" })}>{language === "zh" ? "驳回" : "Reject"}</button></div></article>) : <div className="community-state"><h2>{language === "zh" ? "没有待处理投诉" : "No open complaints"}</h2></div>)}

          {tab === "accounts" && <section aria-busy={usersLoading}><label className="relative block"><span className="sr-only">{language === "zh" ? "搜索账号" : "Search accounts"}</span><Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-ink/40 dark:text-white/40" aria-hidden="true" /><input aria-label={language === "zh" ? "搜索账号" : "Search accounts"} value={query} onChange={(event) => setQuery(event.target.value)} className="atlas-account-input pl-10" placeholder={language === "zh" ? "按名称、邮箱或用户 ID 搜索" : "Search name, email, or user ID"} /></label>{usersLoading && <p className="mt-3 text-xs text-ink/50 dark:text-white/50" role="status">{language === "zh" ? "正在搜索账号…" : "Searching accounts…"}</p>}<div className="mt-5">{(data.users ?? []).map((item) => <AccountGovernanceRow key={item.id} item={item} language={language} busy={busy} isCurrentUser={item.id === user?.id} onSave={(status, reason) => mutate(`/api/journal/admin/users/${encodeURIComponent(item.id)}`, { status, reason })} />)}</div>{!usersLoading && !(data.users ?? []).length && <div className="community-state"><p>{language === "zh" ? "没有匹配账号" : "No matching accounts"}</p></div>}</section>}

          {tab === "audit" && <div className="overflow-x-auto"><table className="w-full min-w-[720px] border-collapse text-left text-sm"><thead><tr className="border-b border-ink/12 text-xs text-ink/50 dark:border-white/12 dark:text-white/50"><th className="px-2 py-3">{language === "zh" ? "时间" : "Time"}</th><th className="px-2 py-3">{language === "zh" ? "操作" : "Action"}</th><th className="px-2 py-3">{language === "zh" ? "目标" : "Target"}</th><th className="px-2 py-3">{language === "zh" ? "说明" : "Reason"}</th></tr></thead><tbody>{(data.audit ?? []).map((item) => <tr key={item.id} className="border-b border-ink/8 align-top dark:border-white/8"><td className="px-2 py-4 text-xs">{formatDate(item.created_at, language)}</td><td className="px-2 py-4 font-semibold">{item.actor_type} · {item.action}</td><td className="px-2 py-4 break-all">{item.target_type}<br /><span className="text-xs text-ink/45 dark:text-white/45">{item.target_id}</span></td><td className="px-2 py-4">{item.reason || "—"}</td></tr>)}</tbody></table>{!(data.audit ?? []).length && <div className="community-state"><p>{language === "zh" ? "暂无审计记录" : "No audit records"}</p></div>}</div>}
        </div>}
      </>}
    </PageContainer>
  </div>;
}

function AccountGovernanceRow({ item, language, busy, isCurrentUser, onSave }: { item: UserRow; language: "zh" | "en"; busy: boolean; isCurrentUser: boolean; onSave: (status: GovernanceStatus, reason: string) => Promise<void> }) {
  const [status, setStatus] = useState<GovernanceStatus>(item.governance_status || "normal");
  const [reason, setReason] = useState(item.governance_reason || "");
  return <article className="grid gap-4 border-b border-ink/10 py-5 dark:border-white/10 lg:grid-cols-[1fr_180px_1.2fr_auto] lg:items-end">
    <div className="min-w-0"><h3 className="truncate font-semibold">{item.name}</h3><p className="mt-1 truncate text-xs text-ink/50 dark:text-white/50">{item.email} · {item.id}</p></div>
    <label className="text-xs font-semibold"><span>{language === "zh" ? "账号状态" : "Account status"}</span><select value={status} onChange={(event) => setStatus(event.target.value as GovernanceStatus)} className="atlas-account-input mt-2"><option value="normal">{language === "zh" ? "正常" : "Normal"}</option><option value="no_upload" disabled={isCurrentUser}>{language === "zh" ? "禁止上传" : "No uploads"}</option><option value="read_only" disabled={isCurrentUser}>{language === "zh" ? "只读" : "Read only"}</option><option value="suspended" disabled={isCurrentUser}>{language === "zh" ? "暂停" : "Suspended"}</option><option value="banned" disabled={isCurrentUser}>{language === "zh" ? "封禁" : "Banned"}</option></select></label>
    <label className="text-xs font-semibold"><span>{language === "zh" ? "原因" : "Reason"}</span><input aria-label={language === "zh" ? "账号状态原因" : "Account status reason"} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} className="atlas-account-input mt-2" /></label>
    <button type="button" disabled={busy || (isCurrentUser && status !== "normal")} className="atlas-secondary-action justify-center disabled:opacity-45" onClick={() => void onSave(status, reason)}>{language === "zh" ? "保存" : "Save"}</button>
  </article>;
}
