import { describe, expect, it, vi } from "vitest";
import {
  createMessageHandler,
  isAuthorizedPrivateSender,
} from "../src/bot.js";
import type { AppConfig } from "../src/config.js";
import type { Logger } from "winston";
import type { MediaDownloader, StatusReporter } from "../src/types.js";

const config: AppConfig = {
  telegram: { botToken: "test-token", apiId: 12345, apiHash: "test-hash" },
  ownerUserId: "5744854503",
  downloadRoot: "/tmp/telegram-bot-test",
  logging: { fileName: "test.log", maxBytes: 1024, backupCount: 1 },
};

const logger = { error: vi.fn(), info: vi.fn() } as unknown as Logger;
const status: StatusReporter = { update: vi.fn().mockResolvedValue(undefined) };

describe("authorization", () => {
  it("仅接受私聊中的指定所有者", () => {
    expect(isAuthorizedPrivateSender({ isPrivate: true, senderId: "5744854503" }, "5744854503")).toBe(true);
    expect(isAuthorizedPrivateSender({ isPrivate: true, senderId: "1" }, "5744854503")).toBe(false);
    expect(isAuthorizedPrivateSender({ isPrivate: false, senderId: "5744854503" }, "5744854503")).toBe(false);
  });

  it("静默忽略非所有者消息", async () => {
    const reply = vi.fn().mockResolvedValue(status);
    const downloader: MediaDownloader = { download: vi.fn() };
    const handler = createMessageHandler({
      config,
      logger,
      now: () => new Date(2026, 8, 6),
      downloader,
    });

    await handler({
      isPrivate: true,
      senderId: "1",
      text: "/start",
      source: { document: { fileName: "private.txt" } },
      reply,
    });

    expect(reply).not.toHaveBeenCalled();
    expect(downloader.download).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("向所有者的 /start 回复中文媒体帮助", async () => {
    const reply = vi.fn().mockResolvedValue(status);
    const downloader: MediaDownloader = { download: vi.fn() };
    const handler = createMessageHandler({
      config,
      logger,
      now: () => new Date(2026, 8, 6),
      downloader,
    });

    await handler({
      isPrivate: true,
      senderId: "5744854503",
      text: "/start",
      source: {},
      reply,
    });

    expect(reply).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledWith("可直接发送支持的媒体，文件会保存至本地月份目录。");
    expect(downloader.download).not.toHaveBeenCalled();
  });
});
