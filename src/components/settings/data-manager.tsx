"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Database, Download, FileJson, Trash2, Upload } from "lucide-react";
import type { Lang } from "@/core/quiz";
import { STORAGE_EVENT } from "@/lib/storage";
import { clearAllData, exportAllData, getDataSummary, importData, type ImportMode } from "@/lib/data-manager";
import { cn } from "@/lib/utils";
import { useAccountIdentity } from "@/components/account/account-provider";

const copy = {
  zh: { summary: "当前摘要", records: "结果记录", bookmarks: "收藏", storage: "占用空间", export: "导出备份", exportDesc: "下载包含结果、收藏、偏好和当前账号个人资料的 JSON 文件。", import: "导入备份", importDesc: "只接受本应用生成的 v3 JSON 备份。", merge: "合并", mergeDesc: "保留当前记录并添加新记录", replace: "替换", replaceDesc: "用备份完全替换当前数据", drop: "拖入 JSON 文件，或点击选择", choose: "选择文件", clear: "清空本地数据", clearDesc: "删除当前游客或当前登录账号在此浏览器中的记录、收藏、会话、偏好和个人资料副本。云端数据不会删除；保持登录时，同步数据会重新下载。", confirm: "再次确认清空", cancel: "取消", success: "操作完成", noData: "当前没有可导出的数据", imported: "条记录已导入", invalid: "无法读取这个备份" },
  en: { summary: "Current snapshot", records: "Results", bookmarks: "Bookmarks", storage: "Storage", export: "Export backup", exportDesc: "Download a JSON file with results, bookmarks, preferences, and the current account profile.", import: "Import backup", importDesc: "Only v3 backups created by this app are accepted.", merge: "Merge", mergeDesc: "Keep current records and add new records", replace: "Replace", replaceDesc: "Fully replace current data with the backup", drop: "Drop a JSON file here, or click to choose", choose: "Choose file", clear: "Clear local data", clearDesc: "Delete the active guest or signed-in account copy of results, bookmarks, sessions, preferences, and profile data in this browser. Cloud data is not deleted; synced data downloads again while you stay signed in.", confirm: "Confirm clear", cancel: "Cancel", success: "Done", noData: "There is no data to export yet", imported: "records imported", invalid: "This backup could not be read" },
} as const;

export function DataManager({ lang = "zh" }: { lang?: Lang }) {
  const t = copy[lang];
  const { user } = useAccountIdentity();
  const [summary, setSummary] = useState({ quizEntries: 0, bookmarks: 0, storageUsed: "0 B", hasProfile: false });
  const [mode, setMode] = useState<ImportMode>("merge");
  const [confirmClear, setConfirmClear] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => setSummary(getDataSummary(user?.id)), [user?.id]);
  useEffect(() => {
    const timer = window.setTimeout(refresh, 0);
    const onChange = () => refresh();
    window.addEventListener(STORAGE_EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(STORAGE_EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, [refresh]);
  useEffect(() => { if (!feedback) return; const timer = window.setTimeout(() => setFeedback(null), 2600); return () => window.clearTimeout(timer); }, [feedback]);

  const handleExport = () => {
    if (!summary.quizEntries && !summary.bookmarks && !summary.hasProfile) { setFeedback({ kind: "error", text: t.noData }); return; }
    exportAllData(user?.id);
    setFeedback({ kind: "success", text: t.success });
  };

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = importData(String(reader.result ?? ""), mode, user?.id);
      if (result.success) { setFeedback({ kind: "success", text: result.imported ? `${result.imported} ${t.imported}` : t.success }); refresh(); }
      else setFeedback({ kind: "error", text: result.message || t.invalid });
    };
    reader.onerror = () => setFeedback({ kind: "error", text: t.invalid });
    reader.readAsText(file);
  };

  return (
    <div className="space-y-5">
      {feedback && <div role={feedback.kind === "error" ? "alert" : "status"} aria-live="polite" className={cn("atlas-data-feedback", feedback.kind === "success" ? "atlas-data-feedback-success" : "atlas-data-feedback-error")}>{feedback.kind === "success" ? <Check className="size-4" aria-hidden="true" /> : <AlertTriangle className="size-4" aria-hidden="true" />}{feedback.text}</div>}
      <div className="atlas-data-summary"><div className="flex items-center gap-2"><Database className="size-4 text-accent" /><h3 className="text-sm font-semibold">{t.summary}</h3></div><div className="mt-5 grid grid-cols-3 gap-3">{[[summary.quizEntries, t.records], [summary.bookmarks, t.bookmarks], [summary.storageUsed, t.storage]] .map(([value, label]) => <div key={String(label)}><strong className="block text-2xl font-semibold">{value}</strong><span className="mt-1 block text-xs text-ink/45 dark:text-white/45">{label}</span></div>)}</div></div>
      <div className="atlas-data-row"><div><h3 className="flex items-center gap-2 text-sm font-semibold"><Download className="size-4 text-accent" aria-hidden="true" />{t.export}</h3><p className="mt-2 text-xs leading-5 text-ink/50 dark:text-white/50">{t.exportDesc}</p></div><button type="button" onClick={handleExport} className="atlas-secondary-action shrink-0"><Download className="size-4" aria-hidden="true" />{t.export}</button></div>
      <div className="atlas-data-row"><div><h3 className="flex items-center gap-2 text-sm font-semibold"><Upload className="size-4 text-accent" aria-hidden="true" />{t.import}</h3><p className="mt-2 text-xs leading-5 text-ink/50 dark:text-white/50">{t.importDesc}</p></div><div className="mt-5 w-full sm:mt-0 sm:max-w-xs"><div className="grid grid-cols-2 gap-2">{(["merge", "replace"] as ImportMode[]).map((value) => <button type="button" key={value} onClick={() => setMode(value)} aria-pressed={mode === value} className={cn("min-h-11 rounded-lg border px-3 py-2 text-left text-xs transition", mode === value ? "border-accent bg-accent/8" : "border-ink/12 dark:border-white/12")}><span className="block font-semibold">{value === "merge" ? t.merge : t.replace}</span><span className="mt-1 block text-[10px] leading-4 text-ink/45 dark:text-white/45">{value === "merge" ? t.mergeDesc : t.replaceDesc}</span></button>)}</div><button type="button" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files?.[0]; if (file) handleFile(file); }} className="atlas-dropzone mt-3" aria-label={t.drop}><FileJson className="size-5 text-accent" aria-hidden="true" /><span>{t.drop}</span><span className="text-[10px] text-ink/35 dark:text-white/35">{t.choose} · .json</span></button><input ref={inputRef} id="backup-file" name="backup-file" aria-label={t.choose} type="file" accept="application/json,.json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) handleFile(file); event.currentTarget.value = ""; }} /></div></div>
      <div className="atlas-data-row atlas-data-danger"><div><h3 className="flex items-center gap-2 text-sm font-semibold"><Trash2 className="size-4 text-red-600 dark:text-red-300" aria-hidden="true" />{t.clear}</h3><p className="mt-2 text-xs leading-5 text-ink/50 dark:text-white/50">{t.clearDesc}</p></div><div className="flex shrink-0 items-center gap-2">{confirmClear && <button type="button" onClick={() => setConfirmClear(false)} className="atlas-text-button">{t.cancel}</button>}<button type="button" onClick={() => { if (!confirmClear) setConfirmClear(true); else { clearAllData(user?.id ?? null); setConfirmClear(false); refresh(); setFeedback({ kind: "success", text: t.success }); } }} className="atlas-danger-action">{confirmClear ? t.confirm : t.clear}</button></div></div>
    </div>
  );
}
