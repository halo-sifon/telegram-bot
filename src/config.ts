import { config as loadDotenv } from "dotenv";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

/**
 * 校验通过后的应用配置。
 */
export interface AppConfig {
  telegram: {
    botToken: string;
    apiId: number;
    apiHash: string;
  };
  ownerUserId: string;
  downloadRoot: string;
  logging: {
    fileName: string;
    maxBytes: number;
    backupCount: number;
  };
}

/**
 * .env 的校验规则:启动时一次性校验,缺失或非法立即失败,
 * 避免机器人连上 Telegram 之后才暴露配置问题。
 */
const environmentSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_API_ID: z.coerce.number().int().positive(),
  TELEGRAM_API_HASH: z.string().min(1),
  /** 用户 ID 保持字符串:Telegram ID 可能超出 JS 安全整数范围 */
  OWNER_USER_ID: z.string().regex(/^\d+$/),
  /** 归档根目录必须是绝对路径,防止因工作目录不同而写错位置 */
  DOWNLOAD_ROOT: z.string().refine(isAbsolute),
  LOG_FILE: z.string().min(1).default("bot.log"),
  LOG_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  LOG_BACKUP_COUNT: z.coerce.number().int().positive().default(5),
});

/**
 * 把 Zod 校验错误转成只含字段名的错误。
 * 刻意不暴露字段值,防止敏感配置进入错误信息和日志。
 */
function invalidConfigurationError(error: z.ZodError): Error {
  const fields = [...new Set(error.issues.map((issue) => issue.path[0]))]
    .filter((field): field is string => typeof field === "string")
    .join(", ");

  return new Error(`Invalid configuration fields: ${fields}`);
}

/**
 * 校验环境变量并返回应用配置;env/cwd 参数化便于调用方替换来源。
 */
export function parseConfig(
  env: Record<string, string | undefined>,
  _cwd: string,
): AppConfig {
  const parsed = environmentSchema.safeParse(env);

  if (!parsed.success) {
    throw invalidConfigurationError(parsed.error);
  }

  return {
    telegram: {
      botToken: parsed.data.TELEGRAM_BOT_TOKEN,
      apiId: parsed.data.TELEGRAM_API_ID,
      apiHash: parsed.data.TELEGRAM_API_HASH,
    },
    ownerUserId: parsed.data.OWNER_USER_ID,
    downloadRoot: parsed.data.DOWNLOAD_ROOT,
    logging: {
      fileName: parsed.data.LOG_FILE,
      maxBytes: parsed.data.LOG_MAX_BYTES,
      backupCount: parsed.data.LOG_BACKUP_COUNT,
    },
  };
}

/**
 * 加载并校验配置:先读 .env(dotenv 不会覆盖已存在的环境变量),再校验。
 */
export function loadConfig(cwd?: string): AppConfig {
  const actualCwd = cwd ?? process.cwd();
  const envFile = resolve(actualCwd, ".env");

  loadDotenv({ path: envFile });

  try {
    return parseConfig(process.env, actualCwd);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw invalidConfigurationError(error);
    }
    throw error;
  }
}
