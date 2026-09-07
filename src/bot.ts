import { TelegramClient } from "telegram";
import { NewMessage } from "telegram/events/index.js";
import { StringSession } from "telegram/sessions/index.js";
import type { Logger } from "winston";
import type { AppConfig } from "./config.js";
import { describeMedia, downloadMediaToStorage } from "./media.js";
import type { MediaDownloader, StatusReporter } from "./types.js";

const START_HELP = "可直接发送支持的媒体，文件会保存至本地月份目录。";

/**
 * 内部消息抽象:核心逻辑只依赖它,不依赖 GramJS 类型。
 */
export interface IncomingMessage {
  isPrivate: boolean;
  senderId?: string;
  text?: string;
  source: unknown;
  reply(text: string): Promise<StatusReporter>;
}

/**
 * 机器人运行句柄,用于优雅退出。
 */
export interface BotRuntime {
  disconnect(): Promise<void>;
}

/**
 * 以下 GramJs* 接口只声明本代码实际用到的 GramJS 结构(结构化类型),
 * 避免把 GramJS 的复杂类型泄漏到核心逻辑。
 */
interface GramJsMessage {
  senderId?: { toString(): string };
  text?: string;
  reply(params: { message: string }): Promise<GramJsStatusMessage | undefined>;
}

interface GramJsStatusMessage {
  edit(params: { text: string }): Promise<unknown>;
}

interface GramJsEvent {
  isPrivate: boolean;
  message: GramJsMessage;
}

/**
 * 授权规则:仅所有者的私聊。
 * 非授权消息静默忽略是刻意的安全设计,不是故障。
 */
export function isAuthorizedPrivateSender(
  message: Pick<IncomingMessage, "isPrivate" | "senderId">,
  ownerUserId: string,
): boolean {
  return message.isPrivate && message.senderId === ownerUserId;
}

/**
 * 消息处理主流程:
 * - /start → 回复帮助
 * - 识别到媒体 → 回复状态消息后下载
 * - 普通文字等其余消息 → 静默忽略
 */
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

/**
 * 把"状态消息"适配为 StatusReporter:进度更新 = 编辑同一条消息。
 *
 * 注意 GramJS 的 API 陷阱:
 * - 发新消息:reply({ message: text })
 * - 编辑消息:edit({ text })
 * edit 传 { message } 会被当作目标消息 ID,报
 * "You have to provide either file or text or schedule property"。
 */
export function createStatusReporter(message: GramJsStatusMessage): StatusReporter {
  return {
    update: async (text) => {
      await message.edit({ text });
    },
  };
}

/**
 * 把 GramJS 的 client.downloadMedia 适配为内部 MediaDownloader 接口。
 * source as never:运行时接受任意媒体消息对象,绕过 GramJS 的类型收窄。
 */
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

/**
 * 把 GramJS 事件适配为内部 IncomingMessage。
 * senderId 转字符串后与 OWNER_USER_ID 比较,避免大整数精度问题。
 */
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
      return createStatusReporter(status);
    },
  };
}

/**
 * 启动机器人:登录 Telegram 并注册新消息处理器。
 * StringSession(""):Bot Token 登录无需持久化会话,空串即可;
 * connectionRetries:断线自动重连次数。
 */
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
