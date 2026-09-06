import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { startBot } from "./bot.js";

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

function reportFatalError(error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

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

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isMainModule()) {
  run().catch(reportFatalError);
}
