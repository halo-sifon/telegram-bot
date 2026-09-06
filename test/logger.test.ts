import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";

async function writeInfo(
  logger: ReturnType<typeof createLogger>,
  metadata: Record<string, unknown>,
): Promise<void> {
  const finished = new Promise<void>((resolve, reject) => {
    logger.once("finish", () => resolve());
    logger.once("error", reject);
  });

  logger.info("download completed", metadata);
  logger.end();
  await finished;
}

describe("createLogger", () => {
  it("writes messages and non-sensitive context to the configured file", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "telegram-logger-"));
    const logPath = join(cwd, "bot.log");
    const logger = createLogger(
      { fileName: "bot.log", maxBytes: 1024 * 1024, backupCount: 2 },
      cwd,
    );

    try {
      await writeInfo(logger, { path: "/store/2026/08/a.jpg" });

      const contents = await readFile(logPath, "utf8");
      expect(contents).toContain("download completed");
      expect(contents).toContain("/store/2026/08/a.jpg");
    } finally {
      logger.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("redacts every configured secret field from file output", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "telegram-logger-"));
    const logPath = join(cwd, "bot.log");
    const logger = createLogger(
      { fileName: "bot.log", maxBytes: 1024 * 1024, backupCount: 2 },
      cwd,
    );
    const secrets = {
      token: "token-secret",
      botToken: "bot-token-secret",
      apiHash: "hash-secret",
      TELEGRAM_BOT_TOKEN: "environment-token-secret",
      TELEGRAM_API_HASH: "environment-hash-secret",
    };

    try {
      await writeInfo(logger, { ...secrets, requestId: "request-123" });

      const contents = await readFile(logPath, "utf8");
      expect(contents).toContain("request-123");
      for (const secret of Object.values(secrets)) {
        expect(contents).not.toContain(secret);
      }
    } finally {
      logger.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
