import { describe, expect, it, vi } from "vitest";
import { run } from "../src/index.js";
import type { AppConfig } from "../src/config.js";
import type { BotRuntime } from "../src/bot.js";
import type { Logger } from "winston";

const config: AppConfig = {
  telegram: { botToken: "test-token", apiId: 12345, apiHash: "test-hash" },
  ownerUserId: "5744854503",
  downloadRoot: "/tmp/telegram-bot-test",
  logging: { fileName: "test.log", maxBytes: 1024, backupCount: 1 },
};

describe("application entrypoint", () => {
  it("disconnects exactly once when either termination signal fires", async () => {
    const disconnect = vi.fn<BotRuntime["disconnect"]>().mockResolvedValue(undefined);
    const listeners = new Map<NodeJS.Signals, () => void>();
    const logger = { info: vi.fn() } as unknown as Logger;

    await run({
      loadConfig: () => config,
      createLogger: () => logger,
      startBot: async () => ({ disconnect }),
      onSignal: (signal, listener) => {
        listeners.set(signal, listener);
      },
    });

    expect(listeners.has("SIGINT")).toBe(true);
    expect(listeners.has("SIGTERM")).toBe(true);

    const firstSignal = listeners.get("SIGINT");
    if (!firstSignal) {
      throw new Error("SIGINT listener was not registered");
    }

    const firstShutdown = firstSignal() as unknown as Promise<void>;
    firstSignal();
    await firstShutdown;

    expect(disconnect).toHaveBeenCalledOnce();
  });
});
