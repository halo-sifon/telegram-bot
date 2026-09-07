import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { startBot } from "./bot.js";

/**
 * 依赖注入:允许调用方替换配置加载、日志、机器人和信号处理的实现。
 */
export interface RunDependencies {
  loadConfig: typeof loadConfig;
  createLogger: typeof createLogger;
  startBot: typeof startBot;
  onSignal: (signal: NodeJS.Signals, listener: () => void) => void;
}

const defaultDependencies: RunDependencies = {
  loadConfig,
  createLogger,
  startBot,
  onSignal: (signal, listener) => {
    process.once(signal, listener);
  },
};

/**
 * 致命错误:打到 stderr 并以非零退出码结束进程。
 */
function reportFatalError(error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

/**
 * 启动流程:加载配置(非法即抛错退出)→ 创建日志 → 连接 Telegram。
 * 停止逻辑幂等(stopping 标志),因为 SIGINT/SIGTERM 可能重复触发。
 */
export async function run(deps: RunDependencies = defaultDependencies): Promise<void> {
  const config = deps.loadConfig();
  const logger = deps.createLogger(config.logging, process.cwd());

  logger.info("telegram bot starting");
  const runtime = await deps.startBot(config, logger);
  let stopping = false;

  const stop = async (): Promise<void> => {
    if (stopping) {
      return;
    }

    stopping = true;
    await runtime.disconnect();
    logger.info("telegram bot stopped");
    process.exitCode = 0;
  };

  const handleSignal = (): void => {
    void stop().catch(reportFatalError);
  };

  deps.onSignal("SIGINT", handleSignal);
  deps.onSignal("SIGTERM", handleSignal);
}

/**
 * ESM 版的 require.main 判断:被作为模块导入时不自动启动。
 */
function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isMainModule()) {
  run().catch(reportFatalError);
}
