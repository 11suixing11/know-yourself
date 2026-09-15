import Image from "next/image";
import Link from "next/link";
import { Globe2, LockKeyhole, Pencil, ShieldAlert } from "lucide-react";
import { journalImageSource, type JournalEntry } from "@/lib/journal";

function formatDate(timestamp: number | undefined, language: "zh" | "en") {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(timestamp);
}

function languageLabel(entry: JournalEntry, language: "zh" | "en") {
  if (entry.contentLanguage === "bilingual") return language === "zh" ? "中英双语" : "Chinese & English";
  if (entry.contentLanguage === "zh") return language === "zh" ? "中文" : "Chinese";
  return "English";
}

export function JournalArticle({
  entry,
  language,
  preview,
  showOwnerActions = false,
  ownerEditHref,
  onReport,
}: {
  entry: JournalEntry;
  language: "zh" | "en";
  preview?: "private" | "public";
  showOwnerActions?: boolean;
  ownerEditHref?: string;
  onReport?: () => void;
}) {
  const publicView = preview === "public" || (!preview && entry.status === "published");
  const date = publicView ? entry.publishedAt : entry.updatedAt;

  return (
    <article className="press-journal-article journal-article" lang={entry.contentLanguage === "bilingual" ? undefined : entry.contentLanguage}>
      {preview && (
        <div className={`journal-preview-banner ${preview === "private" ? "is-private" : "is-public"}`}>
          {preview === "private" ? <LockKeyhole aria-hidden="true" /> : <Globe2 aria-hidden="true" />}
          <span>{preview === "private"
            ? (language === "zh" ? "私密预览" : "Private preview")
            : (language === "zh" ? "公开版预览" : "Public preview")}</span>
        </div>
      )}

      <header className="journal-article-header">
        <p className="journal-article-meta">
          {entry.author?.displayName && <span>{entry.author.displayName}</span>}
          <span>{formatDate(date, language)}</span>
          <span>{languageLabel(entry, language)}</span>
        </p>
        <h1>{entry.title || (language === "zh" ? "未命名札记" : "Untitled journal")}</h1>
        {entry.body && <p className="journal-article-lead">{entry.body}</p>}
        {(showOwnerActions || onReport) && (
          <div className="journal-article-actions">
            {showOwnerActions && <Link href={ownerEditHref ?? `/journal/${entry.id}/edit/`} className="atlas-secondary-action"><Pencil aria-hidden="true" />{language === "zh" ? "编辑札记" : "Edit journal"}</Link>}
            {onReport && <button type="button" className="atlas-text-button" onClick={onReport}><ShieldAlert aria-hidden="true" />{language === "zh" ? "举报" : "Report"}</button>}
          </div>
        )}
      </header>

      <div className="journal-article-sequence">
        {entry.images.map((image, index) => {
          const source = journalImageSource(image, "large");
          if (!source) return null;
          return (
            <figure key={image.id} className="journal-article-figure">
              <div className="journal-article-image">
                <Image
                  src={source.src}
                  alt={image.decorative ? "" : image.alt}
                  width={source.width || image.width}
                  height={source.height || image.height}
                  sizes="(max-width: 760px) 100vw, 760px"
                  priority={index === 0 && !preview}
                  unoptimized
                />
              </div>
              {image.caption && <figcaption>{image.caption}</figcaption>}
            </figure>
          );
        })}
      </div>

    </article>
  );
}
