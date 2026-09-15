"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  CircleAlert,
  Eye,
  FileImage,
  Globe2,
  GripVertical,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  RefreshCw,
  Replace,
  RotateCcw,
  Save,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccountIdentity, useAccountSync } from "@/components/account-provider";
import { JournalArticle } from "@/components/journal/journal-article";
import { AppHeader, PageContainer } from "@/components/shell/app-shell";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { useLanguage } from "@/hooks/use-local-storage";
import {
  createJournalDraft,
  createJournalUploadSession,
  deleteJournalAsset,
  deleteJournalEntry,
  getJournalEntry,
  getJournalLibrary,
  journalImageSource,
  publishJournalEntry,
  reorderJournalAssets,
  replaceJournalAsset,
  saveJournalDraft,
  unpublishJournalEntry,
  updatePublishedJournalEntry,
  uploadJournalAsset,
  type JournalContentLanguage,
  type JournalEntry,
  type JournalImage,
  type JournalViewer,
} from "@/lib/journal";

type EditorMode = "edit" | "private" | "public";
type SaveState = "idle" | "waiting" | "saving" | "saved" | "error";

interface EditorForm {
  title: string;
  body: string;
  contentLanguage: JournalContentLanguage;
  allowComments: boolean;
}

interface RecoverySnapshot extends EditorForm {
  savedAt: number;
  images: Array<Pick<JournalImage, "id" | "position" | "caption" | "alt" | "decorative">>;
}

interface PendingUpload {
  id: string;
  file: File;
  previewUrl: string;
  uploadSessionId: string;
  position: number;
  progress: number;
  status: "uploading" | "failed";
  error: string;
}

const EMPTY_FORM: EditorForm = { title: "", body: "", contentLanguage: "zh", allowComments: true };
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 25_000_000;
const MAX_IMAGES = 6;

function recoveryKey(id: string) {
  return `know-yourself:journal-recovery:${id}`;
}

function readRecovery(id: string): RecoverySnapshot | null {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(recoveryKey(id)) ?? "null") as RecoverySnapshot | null;
    return parsed && typeof parsed.savedAt === "number" && Array.isArray(parsed.images) ? parsed : null;
  } catch {
    return null;
  }
}

function writeRecovery(id: string, form: EditorForm, images: JournalImage[]) {
  try {
    const snapshot: RecoverySnapshot = {
      ...form,
      savedAt: Date.now(),
      images: images.map(({ id: imageId, position, caption, alt, decorative }) => ({ id: imageId, position, caption, alt, decorative })),
    };
    window.localStorage.setItem(recoveryKey(id), JSON.stringify(snapshot));
  } catch {
    // Server autosave remains authoritative when browser storage is unavailable.
  }
}

function clearRecovery(id: string) {
  try { window.localStorage.removeItem(recoveryKey(id)); }
  catch { /* Browser storage can be unavailable in private contexts. */ }
}

function normalizedImages(images: JournalImage[]) {
  return [...images].sort((left, right) => left.position - right.position).map((image, position) => ({ ...image, position }));
}

function draftSignature(form: EditorForm, images: JournalImage[]) {
  return JSON.stringify({
    ...form,
    images: normalizedImages(images).map(({ id, position, caption, alt, decorative }) => ({ id, position, caption, alt, decorative })),
  });
}

function entryForm(entry: JournalEntry): EditorForm {
  return {
    title: entry.title,
    body: entry.body,
    contentLanguage: entry.contentLanguage,
    allowComments: entry.allowComments,
  };
}

function applyRecovery(entry: JournalEntry, recovery: RecoverySnapshot) {
  const byId = new Map(entry.images.map((image) => [image.id, image]));
  const recovered = recovery.images.flatMap((item) => {
    const image = byId.get(item.id);
    if (!image) return [];
    byId.delete(item.id);
    return [{ ...image, ...item }];
  });
  return normalizedImages([...recovered, ...byId.values()]);
}

async function fileDimensions(file: File) {
  if ("createImageBitmap" in window) {
    const bitmap = await createImageBitmap(file);
    const result = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return result;
  }
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("INVALID_IMAGE"));
    };
    image.src = url;
  });
}

async function validateImage(file: File, language: "zh" | "en") {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) throw new Error(language === "zh" ? "仅支持 JPEG、PNG 或 WebP 静态图片。" : "Use a static JPEG, PNG, or WebP image.");
  if (file.size > MAX_FILE_BYTES) throw new Error(language === "zh" ? "单张图片不能超过 8 MiB。" : "Each image must be 8 MiB or smaller.");
  let dimensions: { width: number; height: number };
  try { dimensions = await fileDimensions(file); }
  catch { throw new Error(language === "zh" ? "图片无法读取，请换一张重试。" : "This image could not be read. Choose another file."); }
  if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > MAX_PIXELS) {
    throw new Error(language === "zh" ? "图片像素不能超过 2500 万。" : "The image cannot exceed 25 megapixels.");
  }
}

function editorStatusLabel(entry: JournalEntry, language: "zh" | "en") {
  if (entry.status === "published") return language === "zh" ? "已公开" : "Published";
  if (entry.status === "processing") return language === "zh" ? "图片处理中" : "Processing images";
  if (entry.status === "hidden") return language === "zh" ? "已隐藏" : "Hidden";
  if (entry.status === "unpublished") return language === "zh" ? "已取消公开" : "Unpublished";
  return language === "zh" ? "私密草稿" : "Private draft";
}

function SaveIndicator({ state, language }: { state: SaveState; language: "zh" | "en" }) {
  const icon = state === "saving" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : state === "saved" ? <Check aria-hidden="true" /> : state === "error" ? <CircleAlert aria-hidden="true" /> : <Save aria-hidden="true" />;
  const text = state === "saving"
    ? (language === "zh" ? "保存中" : "Saving")
    : state === "saved"
      ? (language === "zh" ? "已保存" : "Saved")
      : state === "error"
        ? (language === "zh" ? "保存失败" : "Save failed")
        : state === "waiting"
          ? (language === "zh" ? "等待保存" : "Waiting to save")
          : (language === "zh" ? "自动保存" : "Autosave");
  return <span className={`journal-save-indicator is-${state}`}>{icon}{text}</span>;
}

export function JournalEditor({ entryId, createOnMount = false, returnTo }: { entryId?: string; createOnMount?: boolean; returnTo?: string }) {
  const router = useRouter();
  const { language } = useLanguage();
  const { user } = useAccountIdentity();
  const { syncState } = useAccountSync();
  const communityMode = returnTo === "/community/";
  const libraryHref = returnTo ?? "/journal/";
  const [entry, setEntry] = useState<JournalEntry | null>(null);
  const [viewer, setViewer] = useState<JournalViewer | null>(null);
  const [form, setForm] = useState<EditorForm>(EMPTY_FORM);
  const [mode, setMode] = useState<EditorMode>("edit");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const [recoveryRestored, setRecoveryRestored] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [assetBusy, setAssetBusy] = useState<Record<string, { kind: "replace" | "delete"; progress: number }>>({});
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [draggedImageId, setDraggedImageId] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const createStartedRef = useRef(false);
  const hydratedRef = useRef(false);
  const entryRef = useRef<JournalEntry | null>(null);
  const serverBaselineRef = useRef<JournalEntry | null>(null);
  const currentSignatureRef = useRef("");
  const lastSavedSignatureRef = useRef("");
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const replaceEntry = useCallback((next: JournalEntry | ((current: JournalEntry) => JournalEntry)) => {
    setEntry((current) => {
      if (!current) return current;
      const resolved = typeof next === "function" ? next(current) : next;
      entryRef.current = resolved;
      return resolved;
    });
  }, []);

  const initializeEntry = useCallback((loaded: JournalEntry, restoreRecovery = true) => {
    const base = { ...loaded, images: normalizedImages(loaded.images) };
    serverBaselineRef.current = base;
    const recovery = restoreRecovery ? readRecovery(loaded.id) : null;
    const shouldRestore = Boolean(recovery && recovery.savedAt > loaded.updatedAt);
    const restoredForm: EditorForm = shouldRestore && recovery ? {
      title: recovery.title,
      body: recovery.body,
      contentLanguage: recovery.contentLanguage,
      allowComments: recovery.allowComments,
    } : entryForm(base);
    const restoredEntry = shouldRestore && recovery ? { ...base, images: applyRecovery(base, recovery) } : base;
    setEntry(restoredEntry);
    entryRef.current = restoredEntry;
    setForm(restoredForm);
    const serverSignature = draftSignature(entryForm(base), base.images);
    lastSavedSignatureRef.current = serverSignature;
    currentSignatureRef.current = draftSignature(restoredForm, restoredEntry.images);
    setRecoveryRestored(shouldRestore);
    setSaveState(shouldRestore ? "waiting" : "saved");
    hydratedRef.current = true;
  }, []);

  const discardRecovery = useCallback(() => {
    const baseline = serverBaselineRef.current;
    if (!baseline) return;
    clearRecovery(baseline.id);
    initializeEntry(baseline, false);
    setAnnouncement(language === "zh" ? "已恢复服务器保存的草稿" : "Restored the server-saved draft");
  }, [initializeEntry, language]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setLoadError("");
    try {
      const library = await getJournalLibrary(user.id);
      setViewer(library.viewer);
      if (!library.viewer.emailVerified) return;
      if (createOnMount) {
        if (createStartedRef.current) return;
        createStartedRef.current = true;
        const created = await createJournalDraft(user.id, { contentLanguage: language, allowComments: true });
        initializeEntry(created.entry);
        router.replace(`/journal/${created.entry.id}/edit/${communityMode ? "?from=community" : ""}`);
      } else if (entryId) {
        const loaded = await getJournalEntry(entryId, user.id, "draft");
        if (!loaded.entry.isOwner) throw new Error(language === "zh" ? "你没有编辑这篇札记的权限。" : "You cannot edit this journal.");
        initializeEntry(loaded.entry);
      }
    } catch (cause) {
      createStartedRef.current = false;
      setLoadError(cause instanceof Error ? cause.message : (language === "zh" ? "编辑器暂时无法打开" : "The editor is unavailable"));
    } finally {
      setLoading(false);
    }
  }, [communityMode, createOnMount, entryId, initializeEntry, language, router, user]);

  useEffect(() => {
    if (syncState === "loading") return;
    if (!user) {
      setLoading(false);
      return;
    }
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, syncState, user]);

  const queueSave = useCallback((formSnapshot: EditorForm, imagesSnapshot: JournalImage[], signature: string) => {
    if (!user || !entryRef.current || signature === lastSavedSignatureRef.current) return saveQueueRef.current;
    const task = saveQueueRef.current.catch(() => undefined).then(async () => {
      const current = entryRef.current;
      if (!current || signature === lastSavedSignatureRef.current) return;
      setSaveState("saving");
      setSaveError("");
      try {
        const receipt = await saveJournalDraft(user.id, current.id, {
          ...formSnapshot,
          images: normalizedImages(imagesSnapshot).map(({ id, position, caption, alt, decorative }) => ({ id, position, caption, alt, decorative })),
          baseRevision: current.revision,
        });
        replaceEntry((latest) => ({
          ...latest,
          revision: receipt.revision,
          updatedAt: receipt.updatedAt,
          hasUnpublishedChanges: receipt.hasUnpublishedChanges,
        }));
        lastSavedSignatureRef.current = signature;
        if (currentSignatureRef.current === signature) {
          clearRecovery(current.id);
          setRecoveryRestored(false);
          setSaveState("saved");
        } else {
          setSaveState("waiting");
        }
      } catch (cause) {
        setSaveState("error");
        setSaveError(cause instanceof Error ? cause.message : (language === "zh" ? "草稿保存失败" : "Draft save failed"));
        throw cause;
      }
    });
    saveQueueRef.current = task.catch(() => undefined);
    return task;
  }, [language, replaceEntry, user]);

  const signature = useMemo(() => draftSignature(form, entry?.images ?? []), [entry?.images, form]);
  currentSignatureRef.current = signature;

  useEffect(() => {
    if (!hydratedRef.current || !entry || signature === lastSavedSignatureRef.current) return;
    writeRecovery(entry.id, form, entry.images);
    setSaveState((current) => current === "saving" ? current : "waiting");
    const timer = window.setTimeout(() => {
      void queueSave(form, entry.images, signature).catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [entry, form, queueSave, signature]);

  useEffect(() => {
    if (!entry || !user || !entry.images.some((image) => image.status === "queued" || image.status === "processing")) return;
    const timer = window.setInterval(() => {
      void getJournalEntry(entry.id, user.id, "draft").then(({ entry: latest }) => {
        replaceEntry((current) => ({
          ...current,
          status: latest.status,
          images: normalizedImages(latest.images).map((image) => {
            const local = current.images.find((item) => item.id === image.id);
            return local ? { ...image, caption: local.caption, alt: local.alt, decorative: local.decorative } : image;
          }),
          updatedAt: latest.updatedAt,
          revision: latest.revision,
        }));
      }).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [entry, replaceEntry, user]);

  const flushSave = useCallback(async () => {
    const current = entryRef.current;
    if (!current) return;
    const currentSignature = draftSignature(form, current.images);
    if (currentSignature !== lastSavedSignatureRef.current) await queueSave(form, current.images, currentSignature);
    await saveQueueRef.current;
  }, [form, queueSave]);

  const updateImage = (imageId: string, update: Partial<Pick<JournalImage, "caption" | "alt" | "decorative">>) => {
    replaceEntry((current) => ({ ...current, images: current.images.map((image) => image.id === imageId ? { ...image, ...update } : image) }));
  };

  const moveImage = async (imageId: string, targetIndex: number) => {
    if (!entry || !user) return;
    const before = normalizedImages(entry.images);
    const from = before.findIndex((image) => image.id === imageId);
    if (from < 0 || targetIndex < 0 || targetIndex >= before.length || from === targetIndex) return;
    const next = [...before];
    const [moved] = next.splice(from, 1);
    next.splice(targetIndex, 0, moved);
    const ordered = normalizedImages(next);
    replaceEntry((current) => ({ ...current, images: ordered }));
    setAnnouncement(language === "zh" ? `图片已移到第 ${targetIndex + 1} 位` : `Image moved to position ${targetIndex + 1}`);
    try {
      const receipt = await reorderJournalAssets(user.id, entry.id, ordered.map((image) => image.id));
      replaceEntry((current) => ({ ...current, revision: receipt.revision }));
    } catch (cause) {
      replaceEntry((current) => ({ ...current, images: before }));
      setActionError(cause instanceof Error ? cause.message : (language === "zh" ? "图片排序失败" : "Image order could not be saved"));
    }
  };

  const runPendingUpload = useCallback(async (pending: PendingUpload) => {
    if (!user || !entryRef.current) return;
    setPendingUploads((current) => current.map((item) => item.id === pending.id ? { ...item, status: "uploading", error: "", progress: 0 } : item));
    try {
      const response = await uploadJournalAsset({
        userId: user.id,
        entryId: entryRef.current.id,
        uploadSessionId: pending.uploadSessionId,
        file: pending.file,
        position: pending.position,
        onProgress: (progress) => setPendingUploads((current) => current.map((item) => item.id === pending.id ? { ...item, progress } : item)),
      });
      URL.revokeObjectURL(pending.previewUrl);
      setPendingUploads((current) => current.filter((item) => item.id !== pending.id));
      replaceEntry((current) => ({
        ...current,
        status: response.image.status === "ready" ? (current.status === "processing" ? "draft" : current.status) : "processing",
        revision: current.revision + 1,
        updatedAt: Date.now(),
        images: normalizedImages([...current.images, { ...response.image, decorative: false, alt: "" }]),
      }));
      setAnnouncement(language === "zh" ? "图片已上传" : "Image uploaded");
    } catch (cause) {
      setPendingUploads((current) => current.map((item) => item.id === pending.id ? {
        ...item,
        status: "failed",
        error: cause instanceof Error ? cause.message : (language === "zh" ? "上传失败" : "Upload failed"),
      } : item));
    }
  }, [language, replaceEntry, user]);

  const chooseImages = async (files: File[]) => {
    const current = entryRef.current;
    if (!current || !user || !viewer) return;
    setUploadError("");
    const available = MAX_IMAGES - current.images.length - pendingUploads.length;
    if (available <= 0) {
      setUploadError(language === "zh" ? "每篇札记最多 6 张图片。" : "A journal can contain up to 6 images.");
      return;
    }
    if (!turnstileToken) {
      setUploadError(language === "zh" ? "请先完成人机验证。" : "Complete the human verification first.");
      return;
    }
    const selected = files.slice(0, available);
    try {
      for (const file of selected) await validateImage(file, language);
      const { upload } = await createJournalUploadSession(user.id, current.id, turnstileToken);
      setTurnstileReset((value) => value + 1);
      setTurnstileToken("");
      const basePosition = current.images.length + pendingUploads.length;
      const prepared = selected.map((file, index): PendingUpload => ({
        id: `local:${Date.now()}:${index}:${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        uploadSessionId: upload.id,
        position: basePosition + index,
        progress: 0,
        status: "uploading",
        error: "",
      }));
      setPendingUploads((currentUploads) => [...currentUploads, ...prepared]);
      await Promise.all(prepared.map(runPendingUpload));
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : (language === "zh" ? "图片未能加入札记" : "Images could not be added"));
    }
  };

  const replaceImage = async (image: JournalImage, file: File) => {
    const current = entryRef.current;
    if (!current || !user) return;
    setActionError("");
    if (!turnstileToken) {
      setActionError(language === "zh" ? "请先完成人机验证，再替换图片。" : "Complete the human verification before replacing an image.");
      return;
    }
    try {
      await validateImage(file, language);
      const { upload } = await createJournalUploadSession(user.id, current.id, turnstileToken);
      setTurnstileReset((value) => value + 1);
      setTurnstileToken("");
      setAssetBusy((busy) => ({ ...busy, [image.id]: { kind: "replace", progress: 0 } }));
      const response = await replaceJournalAsset(image.id, {
        userId: user.id,
        entryId: current.id,
        uploadSessionId: upload.id,
        file,
        position: image.position,
        onProgress: (progress) => setAssetBusy((busy) => ({ ...busy, [image.id]: { kind: "replace", progress } })),
      });
      replaceEntry((latest) => ({
        ...latest,
        status: response.image.status === "ready" ? (latest.status === "processing" ? "draft" : latest.status) : "processing",
        revision: latest.revision + 1,
        updatedAt: Date.now(),
        images: latest.images.map((item) => item.id === image.id ? { ...response.image, caption: image.caption, alt: image.alt, decorative: image.decorative } : item),
      }));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : (language === "zh" ? "图片替换失败" : "Image replacement failed"));
    } finally {
      setAssetBusy((busy) => { const next = { ...busy }; delete next[image.id]; return next; });
    }
  };

  const removeImage = async (image: JournalImage) => {
    const current = entryRef.current;
    if (!current || !user) return;
    setAssetBusy((busy) => ({ ...busy, [image.id]: { kind: "delete", progress: 0 } }));
    setActionError("");
    try {
      const response = await deleteJournalAsset(user.id, current.id, image.id);
      replaceEntry((latest) => ({
        ...latest,
        revision: response.entry?.revision ?? latest.revision + 1,
        updatedAt: response.entry?.updatedAt ?? Date.now(),
        images: normalizedImages(response.entry?.images ?? latest.images.filter((item) => item.id !== image.id)),
      }));
      setAnnouncement(language === "zh" ? "图片已移除" : "Image removed");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : (language === "zh" ? "图片删除失败" : "Image deletion failed"));
    } finally {
      setAssetBusy((busy) => { const next = { ...busy }; delete next[image.id]; return next; });
    }
  };

  const validationError = useMemo(() => {
    if (!entry || entry.images.length < 1) return language === "zh" ? "至少需要 1 张图片。" : "Add at least 1 image.";
    if (entry.images.some((image) => image.status !== "ready")) return language === "zh" ? "请等待所有图片处理完成。" : "Wait for every image to finish processing.";
    if (entry.images.some((image) => !image.decorative && !image.alt.trim())) return language === "zh" ? "请为非装饰图片填写替代文字。" : "Add alt text for every non-decorative image.";
    if (pendingUploads.length > 0) return language === "zh" ? "请等待上传完成。" : "Wait for uploads to finish.";
    return "";
  }, [entry, language, pendingUploads.length]);

  const publish = async () => {
    const current = entryRef.current;
    if (!current || !user || validationError) return;
    setActionBusy("publish");
    setActionError("");
    try {
      await flushSave();
      const response = current.publicRevision > 0
        ? await updatePublishedJournalEntry(user.id, current.id)
        : await publishJournalEntry(user.id, current.id);
      initializeEntry(response.entry);
      setMode("public");
      if (communityMode && current.publicRevision === 0) {
        router.push("/community/");
      } else {
        router.refresh();
      }
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : (language === "zh" ? "札记未能发布" : "The journal could not be published"));
    } finally {
      setActionBusy("");
    }
  };

  const unpublish = async () => {
    const current = entryRef.current;
    if (!current || !user) return;
    if (!window.confirm(language === "zh" ? "取消公开后，社区与公开链接将无法访问。继续吗？" : "After unpublishing, the community and public link will be unavailable. Continue?")) return;
    setActionBusy("unpublish");
    setActionError("");
    try {
      const response = await unpublishJournalEntry(user.id, current.id);
      initializeEntry(response.entry);
      setMode("private");
      router.refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : (language === "zh" ? "未能取消公开" : "The journal could not be unpublished"));
    } finally {
      setActionBusy("");
    }
  };

  const removeEntry = async () => {
    const current = entryRef.current;
    if (!current || !user) return;
    if (!window.confirm(language === "zh" ? "永久删除这篇札记及其图片？此操作无法撤销。" : "Permanently delete this journal and its images? This cannot be undone.")) return;
    setActionBusy("delete");
    setActionError("");
    try {
      await deleteJournalEntry(user.id, current.id);
      clearRecovery(current.id);
      router.replace(libraryHref);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : (language === "zh" ? "札记删除失败" : "The journal could not be deleted"));
      setActionBusy("");
    }
  };

  const previewEntry = entry ? {
    ...entry,
    ...form,
    images: normalizedImages(entry.images),
    author: entry.author ?? (user ? { displayName: user.displayName } : undefined),
  } : null;

  if (syncState === "loading" || loading) {
    return <div className="press-journal-page atlas-page"><AppHeader backHref={libraryHref} /><PageContainer><div className="journal-state" role="status"><span className="journal-state-pulse" />{language === "zh" ? "正在打开编辑器…" : "Opening editor…"}</div></PageContainer></div>;
  }

  if (!user) {
    return <div className="press-journal-page atlas-page"><AppHeader backHref={libraryHref} /><PageContainer><div className="journal-access-state"><LockKeyhole aria-hidden="true" /><h1>{language === "zh" ? "登录后继续创作" : "Sign in to continue"}</h1><p>{language === "zh" ? "草稿只保存在你的账号中。" : "Drafts are stored only in your account."}</p><Link href="/account/" className="press-primary-action atlas-primary-action">{language === "zh" ? "登录或注册" : "Sign in or register"}</Link></div></PageContainer></div>;
  }

  if (viewer && !viewer.emailVerified) {
    return <div className="press-journal-page atlas-page"><AppHeader backHref={libraryHref} /><PageContainer><div className="journal-access-state"><LockKeyhole aria-hidden="true" /><h1>{language === "zh" ? "验证邮箱后继续" : "Verify your email to continue"}</h1><p>{language === "zh" ? "完成验证后即可保存草稿和上传图片。" : "After verification, you can save drafts and upload images."}</p><Link href="/account/" className="press-primary-action atlas-primary-action">{language === "zh" ? "前往账号" : "Open account"}</Link></div></PageContainer></div>;
  }

  if (loadError || !entry || !previewEntry) {
    return <div className="press-page atlas-page"><AppHeader backHref={libraryHref} /><PageContainer><div className="journal-state journal-state-error"><FileImage aria-hidden="true" /><h1>{language === "zh" ? "编辑器没有打开" : "The editor did not open"}</h1><p>{loadError}</p><div><button type="button" className="press-secondary-action atlas-secondary-action" onClick={() => void load()}><RefreshCw aria-hidden="true" />{language === "zh" ? "重新加载" : "Try again"}</button><Link href={libraryHref} className="press-primary-action atlas-primary-action"><ArrowLeft aria-hidden="true" />{language === "zh" ? "返回" : "Back"}</Link></div></div></PageContainer></div>;
  }

  return (
    <div className="press-journal-page atlas-page journal-editor-page">
      <AppHeader backHref={libraryHref} backLabel={communityMode ? (language === "zh" ? "社区" : "Community") : (language === "zh" ? "个人库" : "Library")} section={communityMode ? (language === "zh" ? "社区图文" : "Community image post") : (language === "zh" ? "札记编辑" : "Journal editor")} />
      <PageContainer className="journal-editor-container">
        <header className="journal-editor-header">
          <div>
            <p className="journal-editor-status"><span />{editorStatusLabel(entry, language)}</p>
            <h1>{form.title.trim() || (language === "zh" ? "未命名札记" : "Untitled journal")}</h1>
          </div>
          <SaveIndicator state={saveState} language={language} />
        </header>

        <div className="journal-mode-switch" role="tablist" aria-label={language === "zh" ? "编辑与预览" : "Edit and preview"}>
          <button type="button" role="tab" aria-selected={mode === "edit"} className={mode === "edit" ? "is-active" : ""} onClick={() => setMode("edit")}><Pencil aria-hidden="true" />{language === "zh" ? "编辑" : "Edit"}</button>
          <button type="button" role="tab" aria-selected={mode === "private"} className={mode === "private" ? "is-active" : ""} onClick={() => setMode("private")}><LockKeyhole aria-hidden="true" />{language === "zh" ? "私密预览" : "Private preview"}</button>
          <button type="button" role="tab" aria-selected={mode === "public"} className={mode === "public" ? "is-active" : ""} onClick={() => setMode("public")}><Eye aria-hidden="true" />{language === "zh" ? "公开预览" : "Public preview"}</button>
        </div>

        <p className="sr-only" aria-live="polite">{announcement}</p>
        {(saveError || actionError) && <p className="journal-error-line" role="alert">{saveError || actionError}</p>}
        {recoveryRestored && <div className="journal-recovery-note"><RotateCcw aria-hidden="true" /><span>{language === "zh" ? "已恢复上次中断前的文字与图片顺序，正在重新保存。" : "Words and image order from the interrupted session were restored and are being saved."}</span><button type="button" onClick={discardRecovery}>{language === "zh" ? "放弃恢复" : "Discard recovery"}</button></div>}

        {mode !== "edit" ? <JournalArticle entry={previewEntry} language={language} preview={mode} /> : (
          <div className="journal-editor-layout">
            <div className="journal-editor-workspace">
              <section className="journal-editor-section journal-editor-writing" aria-labelledby="journal-writing-heading">
                <div className="journal-section-heading"><span>01</span><div><h2 id="journal-writing-heading">{language === "zh" ? "文字" : "Words"}</h2><p>{language === "zh" ? `${Array.from(form.body).length}/5000` : `${Array.from(form.body).length}/5000`}</p></div></div>
                <label htmlFor="journal-title">{language === "zh" ? "标题（可选）" : "Title (optional)"}</label>
                <input id="journal-title" className="journal-title-input" value={form.title} maxLength={120} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder={language === "zh" ? "给这一页一个名字" : "Name this page"} />
                <label htmlFor="journal-body">{language === "zh" ? "正文（可选）" : "Body (optional)"}</label>
                <textarea id="journal-body" value={form.body} maxLength={5000} rows={8} onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))} placeholder={language === "zh" ? "此刻，你想和这些图一起留下什么？" : "What would you like to leave beside these images?"} />
              </section>

              <section className="journal-editor-section journal-editor-images" aria-labelledby="journal-images-heading">
                <div className="journal-section-heading"><span>02</span><div><h2 id="journal-images-heading">{language === "zh" ? "图片" : "Images"}</h2><p>{entry.images.length + pendingUploads.length}/{MAX_IMAGES}</p></div></div>

                <div className="journal-upload-zone">
                  <input ref={uploadInputRef} aria-label={language === "zh" ? "选择札记图片" : "Choose journal images"} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void chooseImages(files); }} />
                  <button type="button" className="journal-upload-button" onClick={() => uploadInputRef.current?.click()} disabled={!turnstileToken || entry.images.length + pendingUploads.length >= MAX_IMAGES || viewer?.accountStatus !== "normal"}>
                    <ImagePlus aria-hidden="true" /><span>{language === "zh" ? "选择图片" : "Choose images"}</span><small>JPEG · PNG · WebP</small>
                  </button>
                  <TurnstileWidget action="journal_upload" language={language} resetSignal={turnstileReset} className="journal-turnstile" onTokenChange={setTurnstileToken} />
                  {uploadError && <p className="journal-upload-error" role="alert">{uploadError}</p>}
                </div>

                <div className="journal-image-list">
                  {entry.images.map((image, index) => {
                    const source = journalImageSource(image, "medium");
                    const busy = assetBusy[image.id];
                    return (
                      <article
                        key={image.id}
                        className={`journal-image-editor ${draggedImageId === image.id ? "is-dragging" : ""}`}
                        onDragOver={(event) => { if (draggedImageId) event.preventDefault(); }}
                        onDrop={(event) => { event.preventDefault(); if (draggedImageId) void moveImage(draggedImageId, index); setDraggedImageId(null); }}
                      >
                        <div className="journal-image-toolbar">
                          <button type="button" draggable onDragStart={() => setDraggedImageId(image.id)} onDragEnd={() => setDraggedImageId(null)} className="journal-drag-handle" aria-label={language === "zh" ? `拖动第 ${index + 1} 张图片` : `Drag image ${index + 1}`} title={language === "zh" ? "拖动排序" : "Drag to reorder"}><GripVertical aria-hidden="true" /></button>
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <div>
                            <button type="button" disabled={index === 0 || Boolean(busy)} onClick={() => void moveImage(image.id, index - 1)} aria-label={language === "zh" ? "上移图片" : "Move image up"} title={language === "zh" ? "上移" : "Move up"}><ArrowUp aria-hidden="true" /></button>
                            <button type="button" disabled={index === entry.images.length - 1 || Boolean(busy)} onClick={() => void moveImage(image.id, index + 1)} aria-label={language === "zh" ? "下移图片" : "Move image down"} title={language === "zh" ? "下移" : "Move down"}><ArrowDown aria-hidden="true" /></button>
                            <label className="journal-icon-control" aria-label={language === "zh" ? "替换图片" : "Replace image"} title={language === "zh" ? "替换" : "Replace"}><Replace aria-hidden="true" /><input aria-label={language === "zh" ? `替换第 ${index + 1} 张图片` : `Replace image ${index + 1}`} type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(busy)} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void replaceImage(image, file); }} /></label>
                            <button type="button" disabled={Boolean(busy)} onClick={() => void removeImage(image)} aria-label={language === "zh" ? "删除图片" : "Delete image"} title={language === "zh" ? "删除" : "Delete"} className="is-danger"><Trash2 aria-hidden="true" /></button>
                          </div>
                        </div>

                        <div className="journal-image-editor-grid">
                          <div className="journal-image-preview">
                            {source ? <Image src={source.src} alt="" width={source.width} height={source.height} sizes="(max-width: 760px) 100vw, 360px" unoptimized /> : <FileImage aria-hidden="true" />}
                            {image.status !== "ready" && <div className={`journal-image-process is-${image.status}`}><span>{image.status === "failed" ? (language === "zh" ? "请替换此图片" : "Replace this image") : (language === "zh" ? "处理中" : "Processing")}</span></div>}
                            {busy && <div className="journal-image-process"><LoaderCircle className="is-spinning" aria-hidden="true" /><span>{busy.kind === "replace" ? `${busy.progress}%` : (language === "zh" ? "删除中" : "Deleting")}</span></div>}
                          </div>
                          <div className="journal-image-fields">
                            <label htmlFor={`caption-${image.id}`}>{language === "zh" ? "图片说明（可选）" : "Caption (optional)"}</label>
                            <textarea id={`caption-${image.id}`} value={image.caption} maxLength={300} rows={3} onChange={(event) => updateImage(image.id, { caption: event.target.value })} />
                            <div className="journal-accessibility-choice">
                              <label><input aria-label={language === "zh" ? `将第 ${index + 1} 张图片设为装饰图片` : `Mark image ${index + 1} as decorative`} type="checkbox" checked={image.decorative} onChange={(event) => updateImage(image.id, { decorative: event.target.checked, alt: event.target.checked ? "" : image.alt })} />{language === "zh" ? "设为装饰图片" : "Mark as decorative"}</label>
                            </div>
                            {!image.decorative && <><label htmlFor={`alt-${image.id}`}>{language === "zh" ? "替代文字" : "Alt text"}</label><textarea id={`alt-${image.id}`} value={image.alt} maxLength={300} rows={3} required onChange={(event) => updateImage(image.id, { alt: event.target.value })} /></>}
                          </div>
                        </div>
                      </article>
                    );
                  })}

                  {pendingUploads.map((pending, index) => (
                    <article key={pending.id} className="journal-image-editor journal-pending-upload">
                      <div className="journal-image-toolbar"><span>{String(entry.images.length + index + 1).padStart(2, "0")}</span><div><button type="button" onClick={() => { URL.revokeObjectURL(pending.previewUrl); setPendingUploads((current) => current.filter((item) => item.id !== pending.id)); }} aria-label={language === "zh" ? "移除待上传图片" : "Remove pending image"}><X aria-hidden="true" /></button></div></div>
                      <div className="journal-pending-grid">
                        <div className="journal-image-preview"><Image src={pending.previewUrl} alt="" width={640} height={480} unoptimized />{pending.status === "uploading" && <div className="journal-image-process"><UploadCloud aria-hidden="true" /><span>{pending.progress}%</span></div>}</div>
                        <div><strong>{pending.file.name}</strong>{pending.status === "failed" ? <><p role="alert">{pending.error}</p><button type="button" className="press-secondary-action atlas-secondary-action" onClick={() => void runPendingUpload(pending)}><RefreshCw aria-hidden="true" />{language === "zh" ? "重试上传" : "Retry upload"}</button></> : <p>{language === "zh" ? "正在上传并清除原始元数据…" : "Uploading and removing original metadata…"}</p>}</div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>

            <aside className="journal-publish-rail" aria-labelledby="journal-publish-heading">
              <div className="journal-section-heading"><span>03</span><div><h2 id="journal-publish-heading">{language === "zh" ? "发布" : "Publish"}</h2><p>{editorStatusLabel(entry, language)}</p></div></div>

              <label htmlFor="journal-language">{language === "zh" ? "内容语言" : "Content language"}</label>
              <select id="journal-language" value={form.contentLanguage} onChange={(event) => setForm((current) => ({ ...current, contentLanguage: event.target.value as JournalContentLanguage }))}>
                <option value="zh">中文</option><option value="en">English</option><option value="bilingual">{language === "zh" ? "中英双语" : "Chinese & English"}</option>
              </select>

              <label className="journal-toggle"><input aria-label={language === "zh" ? "允许留言" : "Allow responses"} type="checkbox" checked={form.allowComments} onChange={(event) => setForm((current) => ({ ...current, allowComments: event.target.checked }))} /><span><strong>{language === "zh" ? "允许留言" : "Allow responses"}</strong><small>{form.allowComments ? (language === "zh" ? "已开启" : "On") : (language === "zh" ? "已关闭" : "Off")}</small></span></label>

              <dl className="journal-publish-checks">
                <div className="is-ready"><dt>{language === "zh" ? "标题" : "Title"}</dt><dd>{form.title.trim() ? <Check aria-label={language === "zh" ? "完成" : "Ready"} /> : (language === "zh" ? "可选" : "Optional")}</dd></div>
                <div className={entry.images.length >= 1 ? "is-ready" : ""}><dt>{language === "zh" ? "图片" : "Images"}</dt><dd>{entry.images.length}/{MAX_IMAGES}</dd></div>
                <div className={!entry.images.some((image) => !image.decorative && !image.alt.trim()) ? "is-ready" : ""}><dt>{language === "zh" ? "无障碍文字" : "Alt text"}</dt><dd>{!entry.images.some((image) => !image.decorative && !image.alt.trim()) ? <Check aria-label={language === "zh" ? "完成" : "Ready"} /> : "—"}</dd></div>
              </dl>

              {validationError && <p className="journal-validation-message"><CircleAlert aria-hidden="true" />{validationError}</p>}
              {entry.hasUnpublishedChanges && entry.publicRevision > 0 && <p className="journal-private-change"><LockKeyhole aria-hidden="true" />{language === "zh" ? "这些修改仍是私密的。" : "These changes are still private."}</p>}

              <button type="button" className="press-primary-action atlas-primary-action journal-publish-action" disabled={Boolean(validationError) || Boolean(actionBusy) || saveState === "error"} onClick={() => void publish()}>
                {actionBusy === "publish" ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Globe2 aria-hidden="true" />}
                {entry.publicRevision > 0 ? (language === "zh" ? "更新公开版" : "Update public version") : (communityMode ? (language === "zh" ? "发布图文帖" : "Publish image post") : (language === "zh" ? "发布札记" : "Publish journal"))}
              </button>
              {entry.status === "published" && <button type="button" className="press-secondary-action atlas-secondary-action journal-unpublish-action" disabled={Boolean(actionBusy)} onClick={() => void unpublish()}><LockKeyhole aria-hidden="true" />{actionBusy === "unpublish" ? (language === "zh" ? "取消中…" : "Unpublishing…") : (language === "zh" ? "取消公开" : "Unpublish")}</button>}
              <button type="button" className="journal-delete-action" disabled={Boolean(actionBusy)} onClick={() => void removeEntry()}><Trash2 aria-hidden="true" />{actionBusy === "delete" ? (language === "zh" ? "删除中…" : "Deleting…") : (language === "zh" ? "永久删除" : "Delete permanently")}</button>
            </aside>
          </div>
        )}
      </PageContainer>
    </div>
  );
}
