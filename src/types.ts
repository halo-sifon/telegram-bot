/**
 * 共享类型定义:核心逻辑只依赖这里的接口,与 GramJS 解耦。
 */

/**
 * 用户可见的媒体类型名称,会原样出现在状态消息里(如"⬇️ 正在下载 视频...")。
 */
export type SupportedMediaType =
  | "图片"
  | "视频"
  | "文件"
  | "动图"
  | "音频"
  | "语音"
  | "视频消息";

/**
 * describeMedia() 的产出:一个已识别媒体的描述。
 */
export interface MediaDescriptor {
  /** 用户可见的中文类型标签 */
  type: SupportedMediaType;
  /** 存储用的文件名(已识别但未清理,清理由 storage.ts 负责) */
  filename: string;
  /** 文件总大小,识别不出来时缺省 */
  sizeBytes?: number;
  /** GramJS 原始消息对象,下载时原样传回给 MediaDownloader */
  source: unknown;
}

/**
 * prepareDestination() 的产出:一次下载的目标路径。
 */
export interface PreparedDestination {
  /** 归档目录(root/YYYY/MM) */
  directory: string;
  /** 最终归档路径 */
  finalPath: string;
  /** 已原子预留的 .part 临时路径,下载期间写入这里 */
  partialPath: string;
}

/**
 * 下载器抽象,由 bot.ts 用 GramJS 的 client.downloadMedia 实现。
 */
export interface MediaDownloader {
  /**
   * 把 source 指向的媒体下载到 outputFile,过程中通过 onProgress 汇报进度。
   */
  download(
    source: unknown,
    outputFile: string,
    onProgress: (downloadedBytes: number, totalBytes: number) => Promise<void>,
  ): Promise<void>;
}

/**
 * 状态汇报抽象,由 bot.ts 实现为"反复编辑同一条 Telegram 消息"。
 */
export interface StatusReporter {
  /** 把状态消息更新为 text */
  update(text: string): Promise<void>;
}
