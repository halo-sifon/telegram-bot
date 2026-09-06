export type SupportedMediaType =
  | "图片"
  | "视频"
  | "文件"
  | "动图"
  | "音频"
  | "语音"
  | "视频消息";

export interface MediaDescriptor {
  type: SupportedMediaType;
  filename: string;
  sizeBytes?: number;
  source: unknown;
}

export interface PreparedDestination {
  directory: string;
  finalPath: string;
  partialPath: string;
}
