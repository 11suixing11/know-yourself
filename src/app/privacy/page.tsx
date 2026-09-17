"use client";

import Link from "next/link";
import { Database, EyeOff, HardDrive, Images, ShieldCheck } from "lucide-react";
import { AppHeader, PageContainer } from "@/components/shell/app-shell";
import { useLanguage } from "@/hooks/use-local-storage";

const content = {
  zh: {
    title: "隐私说明",
    updated: "更新于 2026 年 9 月 17 日",
    intro: "认识你自己是一款本地优先的自我反思应用。游客测评数据留在当前设备；注册并验证邮箱后，本机与云端测评数据会自动合并。你可以在社区主动发布文字、测评分享或图像札记公开快照。",
    items: [
      ["登录后自动同步", "不登录时，结果、收藏、偏好和未完成进度保存在当前浏览器。注册或登录后，这些本机数据会自动与账号云端数据合并；头像、个性签名和标签也会随账号同步。"],
      ["账号验证与云端数据范围", "注册需要显示名称、邮箱、密码和一次 Cloudflare Turnstile 验证；验证 token 只用于当次请求。服务器保存密码哈希而不是明文密码。上传图片与发布札记前必须完成邮箱验证。"],
      ["完成后的原始答案不进云端", "新测评只向服务器提交测评编号和答案用于重新计分；云端结果写入后不保留已完成测评的原始答案。未完成进度在同步开启时会暂存，以便跨设备继续。"],
      ["图像札记与媒体处理", "札记草稿、图片说明和排序保存在账号云端。上传的 JPEG、PNG 或 WebP 会被旋转到正确方向、转换为 sRGB、清除 EXIF、GPS、设备与原文件名，并生成 WebP 变体；原始上传不会保留。私密图片只能通过鉴权接口读取。"],
      ["仅第一方聚合反馈", "本站不接入第三方分析、广告像素或行为画像工具，也不会把测评或札记内容发送给 AI 服务。站内另有匿名聚合计数：页面访问、测评开始与完成、结果是否读完，以及首次完成与 28 天内再次完成这类留存信号，只按日期、界面语言、设备类与测评编号累加；同一设备同一天同一事件最多计一次，不记录账号、答案、attemptId、IP 或结果正文，也不用 cookie 关联访问。结果页可匿名提交“图像是否帮助理解”的反馈，同样只按维度聚合。"],
      ["你可以带走或删除数据", "设置页支持导出、导入或清空当前设备的测评数据。历史结果、札记草稿、公开内容和账号可分别删除；删除账号会删除账号云端数据并通过持久删除墓碑清理媒体，但不会自动删除当前设备的本地测评副本。"],
    ],
    dataTable: "数据、保留期限与删除方式",
    tableHeaders: ["数据", "保留期限", "如何删除"],
    dataRows: [
      ["本机数据：结果、已完成测评的回答、收藏、偏好与个人资料副本", "保留到你主动删除，或浏览器清除本站数据。", "在历史页删除记录，或在设置页清空本机数据。"],
      ["账号资料：显示名称、邮箱、密码哈希与登录会话", "账号资料保留到你删除账号；登录会话最长 30 天，并可能在持续使用时更新。", "在账号页永久删除账号。"],
      ["云端数据：结果、测评名称、完成时间、收藏、偏好、头像、个性签名与标签", "保留到你删除相关记录或删除账号。云端不保留已完成测评的原始答案。", "在历史页删除结果，或在账号页永久删除账号及全部云端数据。"],
      ["私密图像札记：标题、正文、内容语言、图片变体、说明、alt、排序和修订状态", "草稿保留到你删除札记或账号。原始上传在处理后删除；私密变体不会由 Caddy 直接公开。", "在札记库删除札记，或在账号页永久删除账号。"],
      ["公开社区：文字、图像札记快照、测评分享、留言和共鸣", "你主动发布的文字帖子、测评分享和图像札记公开版会立即出现在社区，并可能被搜索引擎索引。札记公开版是不可变快照；取消公开会停止站内访问，删除则同时进入媒体清理流程。搜索引擎或第三方缓存仍可能保留旧副本。", "在对应内容页删除自己的帖子，或在札记详情页取消公开/删除内容；也可以删除账号。"],
      ["举报、投诉、账号治理与审计记录", "举报用于自动隐藏和管理员处理；隐私与版权投诉可不登录提交。账号限制与管理操作写入追加式审计日志，并按运营与争议处理需要保留。", "可通过下方投诉入口请求处理；账号删除会移除账号关联内容，但必要的操作审计可能以最小化形式继续保留。"],
      ["匿名聚合计数：页面访问、测评开始/完成、结果读完、留存信号", "按日累加在服务器上，不含账号、设备或内容标识，无法对应到个人。", "无需删除；服务器仅保留计数本身。"],
      ["未完成进度：当前题目与暂存回答", "云端最多保留 24 小时；每次保存后重新计算，完成测评或到期后删除。", "完成测评、等待进度到期，或删除账号以删除云端进度。"],
      ["本机一致性备份：SQLite、私密与公开媒体、删除墓碑", "每日在同一 VPS 创建一次，滚动保留 30 天。它不构成主机或磁盘故障下的异地灾难恢复。", "备份到期后自动滚动删除；恢复时重放删除墓碑，避免恢复已经删除的媒体。"],
    ],
    hosting: "托管说明",
    hostingText: "站点运行在自有 VPS 上，由 Caddy 提供 HTTPS 并转发到应用服务。结构化数据保存在 SQLite，媒体变体保存在 /var/lib/quiz-platform/media；备份也只保存在同一台 VPS。服务器、Cloudflare Turnstile 和网络服务会处理提供网站及验证请求所需的标准请求元数据。",
    controls: "管理本地数据",
    accountControls: "管理账号与云端数据",
    source: "查看源代码",
    contact: "联系渠道",
    contactText: "隐私泄露或版权问题可通过不要求登录的投诉表单提交。其他数据访问或删除问题可通过项目仓库联系；不要在公开问题中提交密码、测评回答或其他敏感信息。",
    contactLink: "提交隐私或版权投诉",
  },
  en: {
    title: "Privacy notes",
    updated: "Updated September 17, 2026",
    intro: "Know Yourself is a local-first reflection app. Guest assessment data stays on the current device. After registering and verifying email, assessment data can sync with your account. You can choose to publish a text post, assessment share, or image-journal snapshot in the community.",
    items: [
      ["Automatic sync after sign-in", "Without signing in, results, bookmarks, preferences, and unfinished progress stay in this browser. Registration or sign-in automatically merges this device data with the account cloud copy. Avatar, bio, and personality tags also sync with the account."],
      ["Account verification and cloud data", "Registration requires a display name, email address, password, and one Cloudflare Turnstile check. The verification token is used only for that request. The server stores a password hash, not the plain password. Email verification is required before image uploads and journal publishing."],
      ["Completed raw answers stay off the cloud", "A new completion sends only the assessment id and answers for server-side scoring. After the result is stored, completed raw answers are not retained in cloud storage. Unfinished progress may be stored while sync is enabled so another device can continue."],
      ["Image journals and media processing", "Journal drafts, captions, and ordering are stored with the account. Uploaded JPEG, PNG, or WebP files are rotated, converted to sRGB, stripped of EXIF, GPS, device, and original filename metadata, and converted to WebP variants. Originals are not retained. Private variants require an authenticated request."],
      ["First-party aggregate feedback only", "The site has no third-party analytics, advertising pixels, or behavioral profiling, and does not send assessment or journal content to AI services. It also keeps anonymous aggregate counts: page views, assessment starts and completions, whether a result was read to the end, and retention signals such as a first completion or a repeat completion within 28 days are summed only by day, interface language, device class, and assessment id. The same event on the same device counts at most once per day, with no account ids, answers, attempt ids, IP addresses, or result text, and no cookies for cross-visit linkage. Optional result-image feedback is aggregated only by assessment, visual key, helpfulness, and day."],
      ["You can take or delete your data", "Settings lets you export, import, or clear on-device assessment data. Results, journal drafts, public content, and the account can be deleted separately. Account deletion removes cloud data and uses persistent tombstones to clean media, but does not erase local assessment copies on this device."],
    ],
    dataTable: "Data, retention, and deletion",
    tableHeaders: ["Data", "Retention", "How to delete"],
    dataRows: [
      ["On-device data: results, completed answers, bookmarks, preferences, and local profile copies", "Kept until you delete it or the browser clears this site's data.", "Delete records in History, or clear device data in Settings."],
      ["Account data: display name, email, password hash, and sign-in sessions", "Account data is kept until you delete the account. Sign-in sessions last up to 30 days and may refresh while you keep using the service.", "Permanently delete the account on the Account page."],
      ["Cloud data: results, assessment name, completion time, bookmarks, preferences, avatar, bio, and tags", "Kept until you delete the related records or delete the account. Completed raw answers are not retained in the cloud.", "Delete results in History, or permanently delete the account and all cloud data on the Account page."],
      ["Private image journals: title, body, language, image variants, captions, alt text, order, and revision state", "Drafts remain until the journal or account is deleted. Originals are discarded after processing; private variants are not served directly by Caddy.", "Delete the journal in your library, or permanently delete the account."],
      ["Public community: text posts, image-journal snapshots, assessment shares, responses, and resonances", "Text posts, assessment shares, and image-journal public snapshots that you choose to publish appear in the community immediately and may be indexed. A journal's public version is an immutable snapshot. Unpublishing stops site access; deletion also enters the media cleanup flow. Search engines or third-party caches may retain copies.", "Delete your own post from its content page, or unpublish/delete a journal from its detail page; you can also delete the account."],
      ["Reports, complaints, account governance, and audit records", "Reports support automatic hiding and admin decisions. Privacy and copyright complaints can be submitted without an account. Account restrictions and admin actions are written to an append-only audit log and retained as needed for operations and disputes.", "Use the complaint form below for content issues. Account deletion removes account-linked content, while minimal operational audit records may remain."],
      ["Anonymous aggregate counts: page views, assessment starts/completions, results read through, retention signals", "Accumulated by day on the server with no account, device, or content identifiers; they cannot be linked to a person.", "No deletion needed; only the counters themselves are kept."],
      ["Unfinished progress: current question and draft answers", "Cloud drafts are kept for up to 24 hours. The period restarts after each save; completion or expiry removes the draft.", "Finish the assessment, wait for the draft to expire, or delete the account to remove cloud drafts."],
      ["Local consistency backups: SQLite, private and public media, and deletion tombstones", "Created daily on the same VPS and retained on a 30-day rolling basis. This is not off-host disaster recovery for server or disk failure.", "Expired snapshots are rotated automatically. Restore replays deletion tombstones so deleted media is not revived."],
    ],
    hosting: "Hosting note",
    hostingText: "The site runs on a self-managed VPS. Caddy provides HTTPS and forwards requests to the application. Structured data is stored in SQLite, media variants under /var/lib/quiz-platform/media, and backups on the same VPS. The server, Cloudflare Turnstile, and network providers process standard request metadata needed to deliver and verify requests.",
    controls: "Manage local data",
    accountControls: "Manage account and cloud data",
    source: "View source code",
    contact: "Contact",
    contactText: "Use the no-login complaint form for privacy exposure or copyright issues. For other data access or deletion questions, contact the project repository. Do not post passwords, assessment answers, or other sensitive data in a public issue.",
    contactLink: "Submit a privacy or copyright complaint",
  },
} as const;

const icons = [HardDrive, ShieldCheck, Database, Images, EyeOff, Database];

export default function PrivacyPage() {
  const { language } = useLanguage();
  const t = content[language];
  return (
    <div className="atlas-page min-h-screen">
      <AppHeader backHref="/" backLabel={language === "zh" ? "返回首页" : "Back home"} section={t.title} />
      <PageContainer className="max-w-3xl">
        <p className="atlas-section-kicker">{language === "zh" ? "本地优先" : "Local first"}</p>
        <h1 className="atlas-section-title mt-3">{t.title}</h1>
        <p className="mt-3 text-xs text-ink/40 dark:text-white/40">{t.updated}</p>
        <p className="mt-6 max-w-2xl text-base leading-7 text-ink/65 dark:text-white/65">{t.intro}</p>

        <div className="mt-12 border-y border-ink/10 dark:border-white/10">{t.items.map(([title, description], index) => { const Icon = icons[index]; return <section key={title} className="grid gap-4 border-b border-ink/10 py-7 last:border-b-0 dark:border-white/10 sm:grid-cols-[3rem_1fr]"><span className="flex size-10 items-center justify-center rounded-full border border-accent/25 text-accent"><Icon className="size-4" strokeWidth={1.7} /></span><div><h2 className="text-base font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-ink/55 dark:text-white/55">{description}</p></div></section>; })}</div>

        <section className="mt-12" aria-labelledby="data-retention-heading">
          <h2 id="data-retention-heading" className="text-xl font-semibold">{t.dataTable}</h2>
          <div className="mt-5 overflow-x-auto rounded-lg border border-ink/12 dark:border-white/12">
            <table className="w-full min-w-[44rem] border-collapse text-left text-xs leading-5 sm:text-sm">
              <thead className="bg-ink/[0.04] dark:bg-white/[0.05]"><tr>{t.tableHeaders.map((header) => <th key={header} scope="col" className="border-b border-ink/12 px-3 py-3 font-semibold dark:border-white/12 sm:px-4">{header}</th>)}</tr></thead>
              <tbody>{t.dataRows.map(([data, retention, deletion]) => <tr key={data} className="align-top border-b border-ink/10 last:border-b-0 dark:border-white/10"><th scope="row" className="px-3 py-4 font-semibold sm:px-4">{data}</th><td className="px-3 py-4 text-ink/58 dark:text-white/58 sm:px-4">{retention}</td><td className="px-3 py-4 text-ink/58 dark:text-white/58 sm:px-4">{deletion}</td></tr>)}</tbody>
            </table>
          </div>
        </section>

        <section className="atlas-detail-panel mt-10"><p className="atlas-section-kicker">{t.hosting}</p><p className="relative mt-4 text-sm leading-6 text-ink/58 dark:text-white/58">{t.hostingText}</p></section>
        <section className="atlas-settings-section mt-10" aria-labelledby="privacy-contact-heading"><h2 id="privacy-contact-heading" className="text-xl font-semibold">{t.contact}</h2><p className="mt-3 text-sm leading-6 text-ink/58 dark:text-white/58">{t.contactText}</p><Link href="/complaints/" className="atlas-text-link mt-4 justify-start font-semibold">{t.contactLink}</Link></section>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap"><Link href="/settings/#data" className="atlas-primary-action justify-center">{t.controls}</Link><Link href="/account/" className="atlas-secondary-action justify-center">{t.accountControls}</Link><a href="https://github.com/11suixing11/know-yourself" target="_blank" rel="noreferrer" className="atlas-secondary-action justify-center">{t.source}</a></div>
      </PageContainer>
    </div>
  );
}
