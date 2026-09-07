import { access, link, mkdir, open, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { PreparedDestination } from "./types.js";

/**
 * 归档规则:root/YYYY/MM,按下载时的服务器本地时间分月。
 */
export function getMonthlyDirectory(root: string, date: Date): string {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");

  return join(root, year, month);
}

/**
 * 清理 Telegram 传来的文件名:去掉路径分隔符和 NUL,
 * 防止文件名逃逸出归档目录;清理后为空则回退为 "file"。
 */
export function sanitizeStoredFilename(filename: string): string {
  const withoutUnsafeCharacters = filename.replace(/[\\/\0]/g, "");
  const sanitized = basename(withoutUnsafeCharacters);

  if (sanitized === "" || sanitized === "." || sanitized === "..") {
    return "file";
  }

  return sanitized;
}

/**
 * 收窄 node 异常对象上的 code 字段。
 */
function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

/**
 * 判断路径是否存在;只把 ENOENT 解释为"不存在",其余错误照常抛出。
 */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

/**
 * 用 "wx" 模式原子创建 .part 文件:已存在则返回 false,用于抢占下载路径。
 */
async function reservePartialPath(path: string): Promise<boolean> {
  try {
    const handle = await open(path, "wx");
    await handle.close();
    return true;
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) {
      return false;
    }
    throw error;
  }
}

/**
 * 为一次下载预留目标路径,核心原则:绝不覆盖任何已有文件。
 * 同名时追加序号(name (1).ext、name (2).ext ...)直到找到空闲路径;
 * 预留 .part 后再复查一次 finalPath,防并发竞态。
 */
export async function prepareDestination(
  root: string,
  requestedFilename: string,
  date: Date,
): Promise<PreparedDestination> {
  const directory = getMonthlyDirectory(root, date);
  await mkdir(directory, { recursive: true });

  const filename = sanitizeStoredFilename(requestedFilename);
  const extension = extname(filename);
  const name = basename(filename, extension);

  for (let suffix = 0; ; suffix += 1) {
    const suffixText = suffix === 0 ? "" : ` (${suffix})`;
    const finalPath = join(directory, `${name}${suffixText}${extension}`);
    const partialPath = `${finalPath}.part`;

    if (await pathExists(finalPath)) {
      continue;
    }

    if (!(await reservePartialPath(partialPath))) {
      continue;
    }

    if (await pathExists(finalPath)) {
      await unlink(partialPath);
      continue;
    }

    return { directory, finalPath, partialPath };
  }
}

/**
 * 定稿:link + unlink,刻意不用 rename——
 * POSIX rename 在目标已存在时会静默覆盖,违反"绝不覆盖"原则;
 * link 在目标已存在时直接失败,正好满足要求。
 */
export async function finalizeDownload(partialPath: string, finalPath: string): Promise<void> {
  await link(partialPath, finalPath);
  await unlink(partialPath);
}

/**
 * 清理临时文件;只容忍 ENOENT(文件本就不在),其余错误照常抛出。
 */
export async function removeFileIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}
