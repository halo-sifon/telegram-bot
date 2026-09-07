import { resolve } from "node:path";
import {
  createLogger as createWinstonLogger,
  format,
  Logger,
  transports,
} from "winston";

/**
 * 日志配置项。
 */
export interface LoggingOptions {
  fileName: string;
  maxBytes: number;
  backupCount: number;
}

/**
 * 日志输出前会被删除的敏感字段名;
 * 新增敏感配置/字段时必须加到这里。
 */
const SECRET_FIELDS = [
  "token",
  "botToken",
  "apiHash",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_API_HASH",
] as const;

/**
 * Winston format:从每条日志记录中删除敏感字段。
 */
const redactSecrets = format((info) => {
  for (const field of SECRET_FIELDS) {
    delete info[field];
  }

  return info;
});

/**
 * 创建日志器:同时输出到控制台和轮转文件。
 * maxBytes 控制单文件大小上限,backupCount 控制保留份数。
 */
export function createLogger(options: LoggingOptions, cwd: string): Logger {
  const outputFormat = format.combine(
    format.timestamp(),
    redactSecrets(),
    format.json(),
  );

  return createWinstonLogger({
    format: outputFormat,
    transports: [
      new transports.Console(),
      new transports.File({
        filename: resolve(cwd, options.fileName),
        maxsize: options.maxBytes,
        maxFiles: options.backupCount,
      }),
    ],
  });
}
