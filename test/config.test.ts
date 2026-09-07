import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config.js";

const validEnv = {
  TELEGRAM_BOT_TOKEN: "123:token",
  TELEGRAM_API_ID: "30569188",
  TELEGRAM_API_HASH: "a".repeat(32),
  OWNER_USER_ID: "5744854503",
  DOWNLOAD_ROOT: "/var/lib/telegram",
};

describe("parseConfig", () => {
  it("解析有效的绝对路径配置", () => {
    expect(parseConfig(validEnv, "/project")).toMatchObject({
      ownerUserId: "5744854503",
      downloadRoot: "/var/lib/telegram",
      telegram: { apiId: 30569188 },
    });
  });

  it("为未设置的日志配置使用安全默认值", () => {
    expect(parseConfig(validEnv, "/project").logging).toEqual({
      fileName: "bot.log",
      maxBytes: 10 * 1024 * 1024,
      backupCount: 5,
    });
  });

  it("拒绝缺失的 Bot Token", () => {
    expect(() => parseConfig({ ...validEnv, TELEGRAM_BOT_TOKEN: "" }, "/project"))
      .toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  it("拒绝相对下载目录", () => {
    expect(() => parseConfig({ ...validEnv, DOWNLOAD_ROOT: "downloads" }, "/project"))
      .toThrow(/DOWNLOAD_ROOT/);
  });

  it("只在错误中列出无效字段名", () => {
    const secret = "super-secret-token";

    expect(() => parseConfig({ ...validEnv, TELEGRAM_BOT_TOKEN: secret, TELEGRAM_API_ID: "nope" }, "/project"))
      .toThrow(/TELEGRAM_API_ID/);
    expect(() => parseConfig({ ...validEnv, TELEGRAM_BOT_TOKEN: "" }, "/project"))
      .not.toThrow(secret);
  });
});
