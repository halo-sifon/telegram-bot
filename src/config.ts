import { config as loadDotenv } from "dotenv";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

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

const environmentSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_API_ID: z.coerce.number().int().positive(),
  TELEGRAM_API_HASH: z.string().min(1),
  OWNER_USER_ID: z.string().regex(/^\d+$/),
  DOWNLOAD_ROOT: z.string().refine(isAbsolute),
  LOG_FILE: z.string().min(1).default("bot.log"),
  LOG_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  LOG_BACKUP_COUNT: z.coerce.number().int().positive().default(5),
});

function invalidConfigurationError(error: z.ZodError): Error {
  const fields = [...new Set(error.issues.map((issue) => issue.path[0]))]
    .filter((field): field is string => typeof field === "string")
    .join(", ");

  return new Error(`Invalid configuration fields: ${fields}`);
}

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
