"use client";

import Link from "next/link";
import { Check, Moon, Monitor, Sun, UserRound } from "lucide-react";
import { AppHeader, PageContainer } from "@/components/shell/app-shell";
import { DataManager } from "@/components/settings/data-manager";
import { useLanguage, useTheme } from "@/hooks/use-local-storage";
import type { Lang } from "@/core/quiz";
import { cn } from "@/lib/utils";

const themes = [
  { id: "system" as const, icon: Monitor, zh: "跟随系统", en: "System", descriptionZh: "根据设备设置", descriptionEn: "Use device preference" },
  { id: "light" as const, icon: Sun, zh: "浅色", en: "Light", descriptionZh: "纸张与墨色", descriptionEn: "Paper and ink" },
  { id: "dark" as const, icon: Moon, zh: "深色", en: "Dark", descriptionZh: "低光环境", descriptionEn: "For low light" },
];

export default function SettingsPage() {
  const { language, setLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();
  const copy = language === "zh" ? {
    title: "设置",
    intro: "把语言、外观、账号和本机数据调整成适合你的样子。",
    language: "语言",
    languageDescription: "测试内容与界面会使用同一种语言。",
    chinese: "中文",
    english: "English",
    appearance: "外观",
    appearanceDescription: "结果与答题页面会保持同一套主题。",
    data: "本地数据",
    account: "账号与同步",
    accountDescription: "登录后会自动合并本机与云端数据，并在设备之间保持同步。",
    accountAction: "管理账号",
    dataDescription: "这里管理当前设备的数据。你可以随时备份、恢复或清空。",
    privacy: "查看隐私说明",
  } : {
    title: "Settings",
    intro: "Set language, appearance, account sync, and device data controls to fit you.",
    language: "Language",
    languageDescription: "Quiz content and navigation use the same language.",
    chinese: "中文",
    english: "English",
    appearance: "Appearance",
    appearanceDescription: "Results and answering stay in one visual mode.",
    data: "Local data",
    account: "Account and sync",
    accountDescription: "Sign in to merge device and cloud data automatically and keep it synced across devices.",
    accountAction: "Manage account",
    dataDescription: "This section manages data on the current device. Back up, restore, or clear it any time.",
    privacy: "Read privacy notes",
  };

  return (
    <div className="atlas-page min-h-screen">
      <AppHeader backHref="/" backLabel={language === "zh" ? "返回首页" : "Back home"} section={copy.title} />
      <PageContainer className="max-w-3xl">
        <div className="max-w-2xl">
          <p className="atlas-section-kicker">{language === "zh" ? "由你掌控" : "In your hands"}</p>
          <h1 className="atlas-section-title mt-3">{copy.title}</h1>
          <p className="mt-4 text-base leading-7 text-ink/60 dark:text-white/60">{copy.intro}</p>
        </div>

        <section className="atlas-settings-section mt-12">
          <div><h2 className="text-xl font-semibold">{copy.language}</h2><p className="mt-2 text-sm leading-6 text-ink/55 dark:text-white/55">{copy.languageDescription}</p></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2" role="group" aria-label={copy.language}>
            {(["zh", "en"] as Lang[]).map((value) => <button type="button" key={value} onClick={() => setLanguage(value)} aria-pressed={language === value} className={cn("flex min-h-11 items-center justify-between rounded-xl border px-4 py-4 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent", language === value ? "border-accent bg-accent/8" : "border-ink/12 hover:border-ink/30 dark:border-white/12 dark:hover:border-white/30")}><span><span className="block text-sm font-semibold">{value === "zh" ? copy.chinese : copy.english}</span><span className="mt-1 block text-xs text-ink/45 dark:text-white/45">{value === "zh" ? "简体中文" : "English"}</span></span>{language === value && <Check className="size-4 text-accent" aria-hidden="true" />}</button>)}
          </div>
        </section>

        <section className="atlas-settings-section mt-10">
          <div><h2 className="text-xl font-semibold">{copy.appearance}</h2><p className="mt-2 text-sm leading-6 text-ink/55 dark:text-white/55">{copy.appearanceDescription}</p></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3" role="group" aria-label={copy.appearance}>
            {themes.map(({ id, icon: Icon, zh, en, descriptionZh, descriptionEn }) => <button type="button" key={id} onClick={() => setTheme(id)} aria-pressed={theme === id} className={cn("flex min-h-28 flex-col justify-between rounded-xl border p-4 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent", theme === id ? "border-accent bg-accent/8" : "border-ink/12 hover:border-ink/30 dark:border-white/12 dark:hover:border-white/30")}><span className="flex items-center justify-between"><Icon className="size-4 text-accent" aria-hidden="true" />{theme === id && <Check className="size-4 text-accent" aria-hidden="true" />}</span><span><span className="block text-sm font-semibold">{language === "zh" ? zh : en}</span><span className="mt-1 block text-xs text-ink/45 dark:text-white/45">{language === "zh" ? descriptionZh : descriptionEn}</span></span></button>)}
          </div>
        </section>

        <section className="atlas-settings-section mt-10">
          <div><h2 className="text-xl font-semibold">{copy.account}</h2><p className="mt-2 text-sm leading-6 text-ink/55 dark:text-white/55">{copy.accountDescription}</p></div>
          <Link href="/account/" className="atlas-secondary-action mt-5"><UserRound className="size-4" aria-hidden="true" />{copy.accountAction}</Link>
        </section>

        <section className="atlas-settings-section mt-10" id="data">
          <div><h2 className="text-xl font-semibold">{copy.data}</h2><p className="mt-2 text-sm leading-6 text-ink/55 dark:text-white/55">{copy.dataDescription}</p></div>
          <div className="mt-6"><DataManager lang={language} /></div>
        </section>

        <p className="mt-10 text-sm text-ink/45 dark:text-white/45"><Link href="/privacy/" className="atlas-text-link font-semibold">{copy.privacy}</Link></p>
      </PageContainer>
    </div>
  );
}
