import { TelegramClient } from "telegram";
import { NewMessage } from "telegram/events/index.js";
import { StringSession } from "telegram/sessions/index.js";
import type { Logger } from "winston";
import type { AppConfig } from "./config.js";
import { describeMedia, downloadMediaToStorage } from "./media.js";
import type { MediaDownloader, StatusReporter } from "./types.js";

const START_HELP = "可直接发送支持的媒体，文件会保存至本地月份目录。";

export interface IncomingMessage {
  isPrivate: boolean;
  senderId?: string;
  text?: string;
  source: unknown;
  reply(text: string): Promise<StatusReporter>;
}

export interface BotRuntime {
  disconnect(): Promise<void>;
}

interface GramJsMessage {
  senderId?: { toString(): string };
  text?: string;
  reply(params: { message: string }): Promise<GramJsStatusMessage | undefined>;
}

interface GramJsStatusMessage {
  edit(params: { message: string }): Promise<unknown>;
}

interface GramJsEvent {
  isPrivate: boolean;
  message: GramJsMessage;
}

export function isAuthorizedPrivateSender(
  message: Pick<IncomingMessage, "isPrivate" | "senderId">,
  ownerUserId: string,
): boolean {
  return message.isPrivate && message.senderId === ownerUserId;
}

export function createMessageHandler(deps: {
  config: AppConfig;
  logger: Logger;
  now: () => Date;
  downloader: MediaDownloader;
}): (message: IncomingMessage) => Promise<void> {
  return async (message) => {
    if (!isAuthorizedPrivateSender(message, deps.config.ownerUserId)) {
      return;
    }

    if (message.text === "/start") {
      await message.reply(START_HELP);
      return;
    }

    const descriptor = describeMedia(message.source, deps.now());
    if (!descriptor) {
      return;
    }

    const status = await message.reply("⏳ 正在处理...");
    try {
      await downloadMediaToStorage({
        descriptor,
        root: deps.config.downloadRoot,
        now: deps.now(),
        downloader: deps.downloader,
        status,
      });
    } catch (error) {
      await status.update("❌ 下载失败，请稍后重试");
      deps.logger.error("media download failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

function statusReporter(message: GramJsStatusMessage): StatusReporter {
  return {
    update: async (text) => {
      await message.edit({ message: text });
    },
  };
}

function createGramJsDownloader(client: TelegramClient): MediaDownloader {
  return {
    download: async (source, outputFile, onProgress) => {
      const downloaded = await client.downloadMedia(source as never, {
        outputFile,
        progressCallback: (downloadedBytes, totalBytes) => {
          void onProgress(Number(downloadedBytes), Number(totalBytes));
        },
      });

      if (!downloaded) {
        throw new Error("Telegram 未返回下载文件");
      }
    },
  };
}

function adaptIncomingMessage(event: GramJsEvent): IncomingMessage {
  return {
    isPrivate: event.isPrivate,
    senderId: event.message.senderId?.toString(),
    text: event.message.text,
    source: event.message,
    reply: async (text) => {
      const status = await event.message.reply({ message: text });
      if (!status) {
        throw new Error("Telegram 未返回状态消息");
      }
      return statusReporter(status);
    },
  };
}

export async function startBot(config: AppConfig, logger: Logger): Promise<BotRuntime> {
  const client = new TelegramClient(
    new StringSession(""),
    config.telegram.apiId,
    config.telegram.apiHash,
    { connectionRetries: 5 },
  );
  const handler = createMessageHandler({
    config,
    logger,
    now: () => new Date(),
    downloader: createGramJsDownloader(client),
  });

  await client.start({ botAuthToken: config.telegram.botToken });
  client.addEventHandler(
    (event) => handler(adaptIncomingMessage(event as unknown as GramJsEvent)),
    new NewMessage({ incoming: true }),
  );
  logger.info("bot connected");

  return { disconnect: () => client.disconnect() };
}
