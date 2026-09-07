import { afterEach, describe, expect, it } from "vitest";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  describeMedia,
  downloadMediaToStorage,
  formatBytes,
  shouldReportProgress,
} from "../src/media.js";
import type { StatusReporter } from "../src/types.js";

let root: string | undefined;

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
});

describe("media metadata", () => {
  it("为没有原始名称的照片生成 JPG 回退名称", () => {
    const item = describeMedia(
      { photo: { sizes: [] } },
      new Date(2026, 7, 1, 2, 3, 4),
    );

    expect(item).toMatchObject({
      type: "图片",
      filename: "图片_20260801_020304.jpg",
    });
  });

  it("保留文档的原始文件名", () => {
    const item = describeMedia(
      { document: { fileName: "预算.xlsx", size: 1024 } },
      new Date(),
    );

    expect(item).toMatchObject({
      type: "文件",
      filename: "预算.xlsx",
      sizeBytes: 1024,
    });
  });

  it("识别带 GramJS 属性的语音和视频消息", () => {
    expect(
      describeMedia(
        {
          document: {
            size: 12,
            attributes: [{ className: "DocumentAttributeAudio", voice: true }],
          },
        },
        new Date(2026, 7, 1),
      ),
    ).toMatchObject({ type: "语音", filename: "语音_20260801_000000.ogg" });

    expect(
      describeMedia(
        {
          document: {
            size: 12,
            attributes: [{ className: "DocumentAttributeVideo", roundMessage: true }],
          },
        },
        new Date(2026, 7, 1),
      ),
    ).toMatchObject({ type: "视频消息", filename: "视频消息_20260801_000000.mp4" });
  });

  it("未知媒体返回 undefined", () => {
    expect(describeMedia({ text: "not media" }, new Date())).toBeUndefined();
  });
});

describe("media progress", () => {
  it("仅在每增加 5% 或完成时更新进度", () => {
    expect(shouldReportProgress(-1, 1, 100)).toBe(false);
    expect(shouldReportProgress(0, 4, 100)).toBe(false);
    expect(shouldReportProgress(0, 5, 100)).toBe(true);
    expect(shouldReportProgress(95, 100, 100)).toBe(true);
    expect(shouldReportProgress(0, 1, 0)).toBe(false);
  });

  it("格式化字节大小", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024)).toBe("1.0 KB");
  });
});

describe("media download orchestration", () => {
  const statusReporter = (messages: string[]): StatusReporter => ({
    update: async (text) => {
      messages.push(text);
    },
  });

  it("失败时清理 partial 文件并重新抛出原错误", async () => {
    root = await mkdtemp(join(tmpdir(), "telegram-media-"));
    const descriptor = describeMedia(
      { document: { fileName: "broken.bin" } },
      new Date(2026, 7, 1),
    );
    const messages: string[] = [];
    const failure = new Error("network interrupted");

    await expect(
      downloadMediaToStorage({
        descriptor: descriptor!,
        root,
        now: new Date(2026, 7, 1),
        status: statusReporter(messages),
        downloader: {
          download: async (_source, outputFile) => {
            await writeFile(outputFile, "partial");
            throw failure;
          },
        },
      }),
    ).rejects.toBe(failure);

    await expect(access(join(root, "2026", "08", "broken.bin.part"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("成功时定稿文件并报告绝对路径和大小", async () => {
    root = await mkdtemp(join(tmpdir(), "telegram-media-"));
    const descriptor = describeMedia(
      { document: { fileName: "complete.bin" } },
      new Date(2026, 7, 1),
    );
    const messages: string[] = [];
    const finalPath = join(root, "2026", "08", "complete.bin");

    const result = await downloadMediaToStorage({
      descriptor: descriptor!,
      root,
      now: new Date(2026, 7, 1),
      status: statusReporter(messages),
      downloader: {
        download: async (_source, outputFile, onProgress) => {
          await writeFile(outputFile, Buffer.alloc(1024));
          await onProgress(1024, 1024);
        },
      },
    });

    expect(result).toEqual({ finalPath, sizeBytes: 1024 });
    await expect(readFile(finalPath)).resolves.toHaveLength(1024);
    await expect(access(`${finalPath}.part`)).rejects.toMatchObject({ code: "ENOENT" });
    expect(messages.at(-1)).toContain("✅");
    expect(messages.at(-1)).toContain(finalPath);
    expect(messages.at(-1)).toContain("1.0 KB");
  });
});
