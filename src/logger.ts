import { resolve } from "node:path";
import {
  createLogger as createWinstonLogger,
  format,
  Logger,
  transports,
} from "winston";

export interface LoggingOptions {
  fileName: string;
  maxBytes: number;
  backupCount: number;
}

const SECRET_FIELDS = [
  "token",
  "botToken",
  "apiHash",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_API_HASH",
] as const;

const redactSecrets = format((info) => {
  for (const field of SECRET_FIELDS) {
    delete info[field];
  }

  return info;
});

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
