import { access, link, mkdir, open, unlink } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { PreparedDestination } from "./types.js";

export function getMonthlyDirectory(root: string, date: Date): string {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");

  return join(root, year, month);
}

export function sanitizeStoredFilename(filename: string): string {
  const withoutUnsafeCharacters = filename.replace(/[\\/\0]/g, "");
  const sanitized = basename(withoutUnsafeCharacters);

  if (sanitized === "" || sanitized === "." || sanitized === "..") {
    return "file";
  }

  return sanitized;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

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

export async function finalizeDownload(partialPath: string, finalPath: string): Promise<void> {
  await link(partialPath, finalPath);
  await unlink(partialPath);
}

export async function removeFileIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}
