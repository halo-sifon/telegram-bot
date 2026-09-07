import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  finalizeDownload,
  prepareDestination,
  removeFileIfPresent,
} from "./storage.js";
import type {
  MediaDescriptor,
  MediaDownloader,
  StatusReporter,
  SupportedMediaType,
} from "./types.js";

interface RecordLike {
  [key: string]: unknown;
}

/**
 * 每种媒体类型的用户可见中文标签与回退扩展名。
 */
interface MediaKind {
  type: SupportedMediaType;
  extension: string;
}

/**
 * type 是用户可见的中文标签;extension 只在无原始文件名时用于回退命名。
 */
const MEDIA_KINDS: Record<SupportedMediaType, MediaKind> = {
  图片: { type: "图片", extension: ".jpg" },
  视频: { type: "视频", extension: ".mp4" },
  文件: { type: "文件", extension: "" },
  动图: { type: "动图", extension: ".gif" },
  音频: { type: "音频", extension: ".mp3" },
  语音: { type: "语音", extension: ".ogg" },
  视频消息: { type: "视频消息", extension: ".mp4" },
};

/**
 * 收窄 unknown 为可索引对象。
 */
function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null;
}

/**
 * 读取对象上的字段,null/undefined 统一视为缺失。
 */
function mediaValue(source: unknown, key: string): unknown {
  if (!isRecord(source)) {
    return undefined;
  }

  const value = source[key];
  return value === null || value === undefined ? undefined : value;
}

/**
 * 只接受非空字符串。
 */
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * 提取原始文件名。
 * GramJS 不同媒体/版本的文件名字段不统一(fileName/file_name/filename/name),
 * 逐个尝试,包括 document attributes 内的字段。
 */
function filenameFrom(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of ["fileName", "file_name", "filename", "name"]) {
    const filename = stringValue(value[key]);
    if (filename) {
      return filename;
    }
  }

  for (const attribute of attributesFrom(value)) {
    for (const key of ["fileName", "file_name", "filename", "name"]) {
      const filename = stringValue(attribute[key]);
      if (filename) {
        return filename;
      }
    }
  }

  return undefined;
}

/**
 * 取出 document 的 attributes 数组(没有则返回空)。
 */
function attributesFrom(value: unknown): RecordLike[] {
  if (!isRecord(value) || !Array.isArray(value.attributes)) {
    return [];
  }

  return value.attributes.filter(isRecord);
}

/**
 * attributes 项的类型标识,统一小写便于 includes 匹配。
 */
function attributeClassName(attribute: RecordLike): string {
  const className = stringValue(attribute.className) ?? stringValue(attribute.type);
  return className?.toLowerCase() ?? "";
}

/**
 * 判断是否存在满足条件的 attribute。
 */
function hasAttribute(value: unknown, matcher: (attribute: RecordLike) => boolean): boolean {
  return attributesFrom(value).some(matcher);
}

/**
 * 读取文件大小,同样兼容多种字段名。
 */
function readSize(value: unknown): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of ["sizeBytes", "size", "fileSize", "file_size"]) {
    const size = value[key];
    if (typeof size === "number" && Number.isFinite(size) && size >= 0) {
      return size;
    }
  }

  return undefined;
}

/**
 * 照片有多个尺寸,取最大者(即原图大小)。
 */
function largestPhotoSize(value: unknown): number | undefined {
  if (!isRecord(value) || !Array.isArray(value.sizes)) {
    return undefined;
  }

  const sizes = value.sizes.map(readSize).filter((size): size is number => size !== undefined);
  return sizes.length > 0 ? Math.max(...sizes) : undefined;
}

/**
 * MIME 类型前缀匹配,如 hasMimeType(value, "video/")。
 */
function hasMimeType(value: unknown, prefix: string): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const mimeType = stringValue(value.mimeType) ?? stringValue(value.mime_type);
  return mimeType?.toLowerCase().startsWith(prefix) ?? false;
}

/**
 * 以下 isXxx 都是嗅探函数:GramJS 没有统一的媒体类型判别字段,
 * 只能靠 MIME / 扩展名 / document attributes 组合判断。
 */

/** 是否为动图(GIF)。 */
function isGif(value: unknown): boolean {
  const filename = filenameFrom(value)?.toLowerCase();
  const mimeType = isRecord(value)
    ? (stringValue(value.mimeType) ?? stringValue(value.mime_type))?.toLowerCase()
    : undefined;

  return (
    mimeType === "image/gif" ||
    filename?.endsWith(".gif") === true ||
    hasAttribute(value, (attribute) => attributeClassName(attribute).includes("animated"))
  );
}

/** 是否为语音消息(区别于普通音频文件)。 */
function isVoice(value: unknown): boolean {
  if (isRecord(value) && value.voice === true) {
    return true;
  }

  return hasAttribute(value, (attribute) => {
    return attributeClassName(attribute).includes("audio") && attribute.voice === true;
  });
}

/** 是否为普通音频。 */
function isAudio(value: unknown): boolean {
  const filename = filenameFrom(value)?.toLowerCase();
  return (
    hasMimeType(value, "audio/") ||
    (filename !== undefined && /\.(mp3|m4a|aac|flac|wav|oga|opus)$/.test(filename)) ||
    hasAttribute(value, (attribute) => attributeClassName(attribute).includes("audio"))
  );
}

/** 是否为普通视频。 */
function isVideo(value: unknown): boolean {
  const filename = filenameFrom(value)?.toLowerCase();
  return (
    hasMimeType(value, "video/") ||
    (filename !== undefined && /\.(mp4|mkv|mov|avi|webm)$/.test(filename)) ||
    hasAttribute(value, (attribute) => attributeClassName(attribute).includes("video"))
  );
}

/** 是否为圆形视频消息(round video note)。 */
function isVideoMessage(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return value.roundMessage === true || value.round_message === true || value.isRoundMessage === true ||
    hasAttribute(value, (attribute) => {
      return attributeClassName(attribute).includes("video") &&
        (attribute.roundMessage === true || attribute.round_message === true);
    });
}

/**
 * 回退文件名用的时间戳:YYYYMMDD_HHMMSS。
 */
function timestamp(date: Date): string {
  return [
    date.getFullYear().toString().padStart(4, "0"),
    (date.getMonth() + 1).toString().padStart(2, "0"),
    date.getDate().toString().padStart(2, "0"),
  ].join("") +
    "_" +
    [
      date.getHours().toString().padStart(2, "0"),
      date.getMinutes().toString().padStart(2, "0"),
      date.getSeconds().toString().padStart(2, "0"),
    ].join("");
}

/**
 * 无原始文件名时的回退命名,如"视频_20260907_213000.mp4"。
 */
function fallbackFilename(kind: MediaKind, date: Date): string {
  return `${kind.type}_${timestamp(date)}${kind.extension}`;
}

/**
 * 组装 MediaDescriptor;文件名优先原始文件名,缺失则用回退命名。
 */
function descriptorFor(
  source: unknown,
  media: unknown,
  kind: MediaKind,
  now: Date,
  sizeBytes?: number,
): MediaDescriptor {
  const filename = filenameFrom(media) ?? filenameFrom(source) ?? fallbackFilename(kind, now);
  return {
    type: kind.type,
    filename,
    ...(sizeBytes === undefined ? {} : { sizeBytes }),
    source,
  };
}

/**
 * 媒体识别入口:从 GramJS 原始消息嗅探媒体类型。
 * 判断顺序即优先级:photo/videoNote/gif/voice/audio/video 有专属字段先判;
 * document 是兜底,再细分为视频消息/动图/语音/音频/视频/普通文件。
 * 识别不了返回 undefined,调用方会静默忽略该消息。
 */
export function describeMedia(source: unknown, now: Date): MediaDescriptor | undefined {
  if (!isRecord(source)) {
    return undefined;
  }

  const photo = mediaValue(source, "photo");
  if (photo !== undefined) {
    return descriptorFor(source, photo, MEDIA_KINDS.图片, now, readSize(photo) ?? largestPhotoSize(photo));
  }

  const videoMessage =
    mediaValue(source, "videoNote") ??
    mediaValue(source, "video_note") ??
    mediaValue(source, "videoMessage");
  if (videoMessage !== undefined) {
    return descriptorFor(source, videoMessage, MEDIA_KINDS.视频消息, now, readSize(videoMessage));
  }

  const gif = mediaValue(source, "gif") ?? mediaValue(source, "animation");
  if (gif !== undefined) {
    return descriptorFor(source, gif, MEDIA_KINDS.动图, now, readSize(gif));
  }

  const voice = mediaValue(source, "voice");
  if (voice !== undefined) {
    return descriptorFor(source, voice, MEDIA_KINDS.语音, now, readSize(voice));
  }

  const audio = mediaValue(source, "audio");
  if (audio !== undefined) {
    return descriptorFor(source, audio, MEDIA_KINDS.音频, now, readSize(audio));
  }

  const video = mediaValue(source, "video");
  if (video !== undefined) {
    const kind = isVideoMessage(video) ? MEDIA_KINDS.视频消息 : MEDIA_KINDS.视频;
    return descriptorFor(source, video, kind, now, readSize(video));
  }

  const document = mediaValue(source, "document");
  if (document === undefined) {
    return undefined;
  }

  if (isVideoMessage(document)) {
    return descriptorFor(source, document, MEDIA_KINDS.视频消息, now, readSize(document));
  }
  if (isGif(document)) {
    return descriptorFor(source, document, MEDIA_KINDS.动图, now, readSize(document));
  }
  if (isVoice(document)) {
    return descriptorFor(source, document, MEDIA_KINDS.语音, now, readSize(document));
  }
  if (isAudio(document)) {
    return descriptorFor(source, document, MEDIA_KINDS.音频, now, readSize(document));
  }
  if (isVideo(document)) {
    return descriptorFor(source, document, MEDIA_KINDS.视频, now, readSize(document));
  }

  return descriptorFor(source, document, MEDIA_KINDS.文件, now, readSize(document));
}

/**
 * 格式化字节数为人类可读文本,如 "10.0 MB"。
 */
export function formatBytes(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0.0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(sizeBytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = sizeBytes / 1024 ** unitIndex;
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * 进度节流:每 5% 才汇报一次(100% 必报),
 * 避免频繁编辑消息触发 Telegram 限流。
 */
export function shouldReportProgress(
  previouslyReportedPercent: number,
  downloadedBytes: number,
  totalBytes: number,
): boolean {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(downloadedBytes)) {
    return false;
  }

  const percent = (downloadedBytes / totalBytes) * 100;
  return percent >= 100 || percent - previouslyReportedPercent >= 5;
}

/**
 * 生成进度条文本,如:⬇️ 正在下载 视频 [████░░░░░░] 42% (4.2 MB / 10.0 MB)。
 */
function progressText(
  type: SupportedMediaType,
  downloadedBytes: number,
  totalBytes: number,
): string {
  const percent = Math.max(0, Math.min(100, (downloadedBytes / totalBytes) * 100));
  const filled = Math.round(percent / 10);
  const bar = "█".repeat(filled) + "░".repeat(10 - filled);
  return `⬇️ 正在下载 ${type} [${bar}] ${percent.toFixed(0)}% (${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)})`;
}

/**
 * 下载编排:预留 .part → 下载进 .part(带进度汇报)→ 定稿为最终文件名。
 * 任何一步失败都会清理 .part,不留半成品文件。
 */
export async function downloadMediaToStorage(input: {
  descriptor: MediaDescriptor;
  root: string;
  now: Date;
  downloader: MediaDownloader;
  status: StatusReporter;
}): Promise<{ finalPath: string; sizeBytes: number }> {
  const destination = await prepareDestination(
    resolve(input.root),
    input.descriptor.filename,
    input.now,
  );

  try {
    await input.status.update(`⬇️ 正在下载 ${input.descriptor.type}...`);

    let previouslyReportedPercent = 0;
    await input.downloader.download(
      input.descriptor.source,
      destination.partialPath,
      async (downloadedBytes, totalBytes) => {
        if (!shouldReportProgress(previouslyReportedPercent, downloadedBytes, totalBytes)) {
          return;
        }

        await input.status.update(progressText(input.descriptor.type, downloadedBytes, totalBytes));
        previouslyReportedPercent = Math.min(100, Math.max(0, (downloadedBytes / totalBytes) * 100));
      },
    );

    const sizeBytes = (await stat(destination.partialPath)).size;
    await finalizeDownload(destination.partialPath, destination.finalPath);

    const finalPath = resolve(destination.finalPath);
    await input.status.update(
      `✅ ${input.descriptor.type} 已保存至 ${finalPath}（${formatBytes(sizeBytes)}）`,
    );

    return { finalPath, sizeBytes };
  } catch (error) {
    try {
      await removeFileIfPresent(destination.partialPath);
    } catch {
      // Preserve the download/finalization error when cleanup itself fails.
    }
    throw error;
  }
}
