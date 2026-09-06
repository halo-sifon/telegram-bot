import { afterEach, describe, expect, it } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  finalizeDownload,
  getMonthlyDirectory,
  prepareDestination,
  removeFileIfPresent,
  sanitizeStoredFilename,
} from "../src/storage.js";

let root: string | undefined;

afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true });
    root = undefined;
  }
});

describe("storage", () => {
  it("把 2026 年 8 月映射到 YYYY/MM 目录", () => {
    expect(getMonthlyDirectory("/store", new Date(2026, 7, 15, 12))).toBe("/store/2026/08");
  });

  it("创建缺失的月度目录", async () => {
    root = await mkdtemp(join(tmpdir(), "telegram-storage-"));

    const destination = await prepareDestination(root, "report.pdf", new Date(2026, 7, 15));

    await expect(stat(destination.directory)).resolves.toBeDefined();
  });

  it("同名文件绝不覆盖，而是使用数字后缀", async () => {
    root = await mkdtemp(join(tmpdir(), "telegram-storage-"));
    await mkdir(join(root, "2026", "08"), { recursive: true });
    await writeFile(join(root, "2026", "08", "report.pdf"), "first");

    const destination = await prepareDestination(root, "report.pdf", new Date(2026, 7, 15));

    expect(destination.finalPath).toBe(join(root, "2026", "08", "report (1).pdf"));
  });

  it("临时文件存在时也使用下一个数字后缀", async () => {
    root = await mkdtemp(join(tmpdir(), "telegram-storage-"));
    await mkdir(join(root, "2026", "08"), { recursive: true });
    await writeFile(join(root, "2026", "08", "report.pdf.part"), "partial");

    const destination = await prepareDestination(root, "report.pdf", new Date(2026, 7, 15));

    expect(destination.finalPath).toBe(join(root, "2026", "08", "report (1).pdf"));
    expect(destination.partialPath).toBe(`${destination.finalPath}.part`);
  });

  it("清理文件名后不会把路径穿越到月度目录之外", async () => {
    root = await mkdtemp(join(tmpdir(), "telegram-storage-"));
    const monthlyDirectory = join(root, "2026", "08");

    const destination = await prepareDestination(root, "../../secret.txt", new Date(2026, 7, 15));

    expect(destination.directory).toBe(monthlyDirectory);
    expect(destination.finalPath.startsWith(`${monthlyDirectory}/`)).toBe(true);
    await expect(access(destination.finalPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("移除 NUL 和路径分隔符，并为保留名称返回安全名称", () => {
    expect(sanitizeStoredFilename("a/b\\c\0.txt")).toBe("abc.txt");
    expect(sanitizeStoredFilename(".")).toBe("file");
    expect(sanitizeStoredFilename("..")).toBe("file");
    expect(sanitizeStoredFilename("/")).toBe("file");
  });

  it("以同目录原子重命名完成下载定稿", async () => {
    root = await mkdtemp(join(tmpdir(), "telegram-storage-"));
    const partialPath = join(root, "download.pdf.part");
    const finalPath = join(root, "download.pdf");
    await writeFile(partialPath, "complete");

    await finalizeDownload(partialPath, finalPath);

    await expect(readFile(finalPath, "utf8")).resolves.toBe("complete");
    await expect(access(partialPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("删除已存在文件并忽略文件不存在", async () => {
    root = await mkdtemp(join(tmpdir(), "telegram-storage-"));
    const filePath = join(root, "stale.part");
    await writeFile(filePath, "stale");

    await removeFileIfPresent(filePath);
    await expect(access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(removeFileIfPresent(filePath)).resolves.toBeUndefined();
  });
});
