# Telegram Bot TypeScript 重写实施计划

> **供代理工作者使用：** 必需子技能：使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐任务实施本计划。每一步均使用复选框（`- [ ]`）追踪。

**目标：** 在 `/Users/sifon/docker/telegram-bot` 构建一个仅处理指定所有者私聊媒体、使用 MTProto 下载并按年月保存到本地 WebDAV 目录的 TypeScript Telegram 机器人。

**架构：** 单个 GramJS/MTProto Node.js 进程接收 Telegram 更新。消息路由先执行私聊和所有者校验，再将受支持媒体交给可独立测试的下载服务；下载服务通过存储模块创建 `YYYY/MM` 目录、生成不冲突的文件名，并以临时文件加原子重命名完成落盘。

**技术栈：** Node.js 20+、TypeScript、GramJS（`telegram`）、`dotenv`、Zod、Winston、Vitest、PM2。

**设计：** `docs/superpowers/specs/2026-09-06-telegram-bot-typescript-design.md`

## 全局约束

- 项目根目录固定为 `/Users/sifon/docker/telegram-bot`；不得修改或删除旧项目 `/Users/sifon/docker/aliyun-bot`。
- 仅允许 Telegram 用户 ID `5744854503` 触发处理，其他发送者必须完全静默。
- `DOWNLOAD_ROOT` 默认值为 `/Users/sifon/docker/webdav/data/telegram`，并且必须是绝对路径。
- 使用 GramJS/MTProto，不使用普通 Bot API 下载路径，以保留约 2 GB 下载能力。
- 不得添加任何阿里云盘、`aligo`、扫码登录、上传或 Docker/systemd 相关功能。
- `.env` 绝不提交；Token、API Hash 和完整环境变量绝不写入日志。
- PM2 配置文件名固定为 `ecosystem.config.json`。
- 当前目标目录不是 Git 仓库，且用户未授权初始化仓库或提交；本计划中的每个任务以可重复执行的验证命令收尾，不执行 `git init`、`git add` 或 `git commit`。

---

## 文件职责总览

| 文件 | 职责 |
| --- | --- |
| `package.json` | 固定运行、构建、类型检查和测试命令及依赖版本范围。 |
| `tsconfig.json` | 使用 NodeNext 模块解析将 `src/` 编译至 `dist/`。 |
| `vitest.config.ts` | 为 Node 环境中的 `test/**/*.test.ts` 提供 Vitest 配置。 |
| `.env.example` | 提供不含密钥的运行时配置模板。 |
| `.gitignore` | 排除密钥、依赖、构建产物、日志和未完成下载。 |
| `src/config.ts` | 加载 `.env` 并对所有运行时配置做唯一的解析与校验。 |
| `src/types.ts` | 定义纯业务层使用的媒体、进度、下载器和状态报告接口。 |
| `src/storage.ts` | 生成月度目录、安全文件名、临时路径、冲突路径和文件定稿/清理操作。 |
| `src/media.ts` | 从 Telegram 媒体生成业务描述，格式化大小，计算进度更新阈值，编排下载。 |
| `src/logger.ts` | 创建不会泄露密钥的控制台及轮转文件 Winston 日志器。 |
| `src/bot.ts` | 建立 GramJS 客户端，执行私聊/所有者过滤，处理 `/start`，适配 Telegram 下载与状态消息。 |
| `src/index.ts` | 将配置、日志和机器人组合为可优雅退出的进程。 |
| `test/*.test.ts` | 覆盖配置、存储、媒体工具和授权路由的确定性单元测试。 |
| `ecosystem.config.json` | PM2 进程名、工作目录、入口文件与自动重启配置。 |
| `README.md` | 中文的本地、PM2 和排障操作说明。 |

### Task 1: 建立 Node.js/TypeScript 工程与安全配置

**文件：**
- 新建：`package.json`
- 新建：`tsconfig.json`
- 新建：`vitest.config.ts`
- 新建：`.env.example`
- 新建：`.gitignore`
- 新建：`src/config.ts`
- 新建：`test/config.test.ts`

**接口：**
- 产出：`AppConfig`、`parseConfig(env, cwd)`、`loadConfig(cwd)`。
- 被后续任务使用：`config.telegram.botToken`、`config.telegram.apiId`、`config.telegram.apiHash`、`config.ownerUserId`、`config.downloadRoot`、`config.logging`。

- [ ] **步骤 1：创建包清单和 TypeScript/Vitest 配置。**

  在 `package.json` 写入以下脚本和依赖；使用 ESM，以便 NodeNext 解析与 GramJS 保持一致：

  ```json
  {
    "name": "telegram-bot",
    "private": true,
    "version": "0.1.0",
    "type": "module",
    "engines": { "node": ">=20" },
    "scripts": {
      "build": "tsc -p tsconfig.json",
      "typecheck": "tsc -p tsconfig.json --noEmit",
      "test": "vitest run",
      "start": "node dist/index.js"
    },
    "dependencies": {
      "dotenv": "^16.6.1",
      "telegram": "^2.26.22",
      "winston": "^3.17.0",
      "zod": "^3.24.4"
    },
    "devDependencies": {
      "@types/node": "^22.15.21",
      "typescript": "^5.8.3",
      "vitest": "^3.2.2"
    }
  }
  ```

  `tsconfig.json` 必须采用下列关键编译选项：

  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "rootDir": "src",
      "outDir": "dist",
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true
    },
    "include": ["src/**/*.ts"]
  }
  ```

  `vitest.config.ts` 使用 `defineConfig({ test: { environment: "node", include: ["test/**/*.test.ts"] } })`。安装依赖：

  ```bash
  cd /Users/sifon/docker/telegram-bot
  npm install
  ```

- [ ] **步骤 2：写入会失败的配置解析测试。**

  在 `test/config.test.ts` 使用纯对象调用 `parseConfig`，不要依赖真实 `.env`。至少写入以下断言：

  ```ts
  import { describe, expect, it } from "vitest";
  import { parseConfig } from "../src/config.js";

  const validEnv = {
    TELEGRAM_BOT_TOKEN: "123:token",
    TELEGRAM_API_ID: "30569188",
    TELEGRAM_API_HASH: "a".repeat(32),
    OWNER_USER_ID: "5744854503",
    DOWNLOAD_ROOT: "/var/lib/telegram"
  };

  describe("parseConfig", () => {
    it("解析有效的绝对路径配置", () => {
      expect(parseConfig(validEnv, "/project")).toMatchObject({
        ownerUserId: "5744854503",
        downloadRoot: "/var/lib/telegram",
        telegram: { apiId: 30569188 }
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
  });
  ```

- [ ] **步骤 3：运行测试，确认其因缺少实现而失败。**

  运行：

  ```bash
  npm test -- test/config.test.ts
  ```

  预期：失败，错误包含无法解析 `../src/config.js` 或找不到导出的 `parseConfig`。

- [ ] **步骤 4：实现配置模块。**

  在 `src/config.ts` 定义下列稳定接口。所有者 ID 保持字符串，避免将未来更大的 Telegram ID 转为不安全的 JavaScript `number`：

  ```ts
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

  export function parseConfig(
    env: Record<string, string | undefined>,
    cwd: string,
  ): AppConfig;

  export function loadConfig(cwd?: string): AppConfig;
  ```

  `parseConfig` 使用 Zod 执行以下规则：Bot Token、API Hash 非空；`TELEGRAM_API_ID` 是正整数；`OWNER_USER_ID` 符合 `/^\d+$/`；`DOWNLOAD_ROOT` 经 `node:path.isAbsolute` 检查为绝对路径；`LOG_MAX_BYTES` 和 `LOG_BACKUP_COUNT` 为正整数。未设置日志变量时，分别默认 `bot.log`、`10 * 1024 * 1024` 和 `5`。

  `loadConfig` 必须只从 `resolve(cwd ?? process.cwd(), ".env")` 加载 dotenv，然后调用 `parseConfig(process.env, actualCwd)`。捕获 Zod 错误后，抛出仅列出无效字段名的 `Error`，不得包含字段值。

- [ ] **步骤 5：添加安全配置模板与忽略规则。**

  创建 `.env.example`，内容严格为：

  ```dotenv
  TELEGRAM_BOT_TOKEN=
  TELEGRAM_API_ID=
  TELEGRAM_API_HASH=
  OWNER_USER_ID=5744854503
  DOWNLOAD_ROOT=/Users/sifon/docker/webdav/data/telegram
  LOG_FILE=bot.log
  LOG_MAX_BYTES=10485760
  LOG_BACKUP_COUNT=5
  ```

  创建 `.gitignore`，至少包含：

  ```gitignore
  .env
  node_modules/
  dist/
  *.log
  *.session
  *.part
  ```

- [ ] **步骤 6：验证本任务。**

  运行：

  ```bash
  npm test -- test/config.test.ts
  npm run typecheck
  ```

  预期：所有配置测试通过；类型检查通过。

### Task 2: 实现月度存储、安全文件名与文件定稿

**文件：**
- 新建：`src/types.ts`
- 新建：`src/storage.ts`
- 新建：`test/storage.test.ts`

**接口：**
- 消费：`AppConfig.downloadRoot`。
- 产出：`SupportedMediaType`、`MediaDescriptor`、`getMonthlyDirectory`、`prepareDestination`、`finalizeDownload`、`removeFileIfPresent`。
- 被后续任务使用：下载服务调用 `prepareDestination` 获得最终路径和同目录 `.part` 路径。

- [ ] **步骤 1：定义业务类型与会失败的存储测试。**

  在 `src/types.ts` 写入：

  ```ts
  export type SupportedMediaType =
    | "图片"
    | "视频"
    | "文件"
    | "动图"
    | "音频"
    | "语音"
    | "视频消息";

  export interface MediaDescriptor {
    type: SupportedMediaType;
    filename: string;
    sizeBytes?: number;
    source: unknown;
  }

  export interface PreparedDestination {
    directory: string;
    finalPath: string;
    partialPath: string;
  }
  ```

  在 `test/storage.test.ts` 用 `mkdtemp` 创建隔离测试根目录，加入下列测试：

  ```ts
  it("把 2026 年 8 月映射到 YYYY/MM 目录", () => {
    expect(getMonthlyDirectory("/store", new Date(2026, 7, 15, 12))).toBe("/store/2026/08");
  });

  it("创建缺失的月度目录", async () => {
    const destination = await prepareDestination(root, "report.pdf", new Date(2026, 7, 15));
    await expect(stat(destination.directory)).resolves.toBeDefined();
  });

  it("同名文件绝不覆盖，而是使用数字后缀", async () => {
    await mkdir(join(root, "2026", "08"), { recursive: true });
    await writeFile(join(root, "2026", "08", "report.pdf"), "first");
    const destination = await prepareDestination(root, "report.pdf", new Date(2026, 7, 15));
    expect(destination.finalPath).toBe(join(root, "2026", "08", "report (1).pdf"));
  });
  ```

- [ ] **步骤 2：运行存储测试，确认失败。**

  运行：

  ```bash
  npm test -- test/storage.test.ts
  ```

  预期：失败，提示尚未定义 `getMonthlyDirectory` 或 `prepareDestination`。

- [ ] **步骤 3：实现存储模块。**

  在 `src/storage.ts` 实现以下接口：

  ```ts
  export function getMonthlyDirectory(root: string, date: Date): string;

  export function sanitizeStoredFilename(filename: string): string;

  export async function prepareDestination(
    root: string,
    requestedFilename: string,
    date: Date,
  ): Promise<PreparedDestination>;

  export async function finalizeDownload(partialPath: string, finalPath: string): Promise<void>;

  export async function removeFileIfPresent(path: string): Promise<void>;
  ```

  实现要求：

  - `getMonthlyDirectory` 使用本地 `date.getFullYear()` 和 `date.getMonth() + 1`，月数必须 `padStart(2, "0")`。
  - `sanitizeStoredFilename` 去掉路径分隔符、NUL 字符和 `.`/`..` 名称；清理后为空时返回 `file`。它必须只返回单一文件名，不能包含目录成分。
  - `prepareDestination` 先 `mkdir(directory, { recursive: true })`，再以 `extname`、`basename` 和 `access` 查询连续的 `name.ext`、`name (1).ext`、`name (2).ext`，直到发现不存在的候选路径。`partialPath` 必须等于 `${finalPath}.part`，并且若该 partial 文件已存在也继续递增候选名。
  - `finalizeDownload` 使用 `rename`，以同目录的原子重命名完成文件定稿。
  - `removeFileIfPresent` 仅忽略 `ENOENT`；其他删除错误必须继续抛出，以便调用者记录日志。

- [ ] **步骤 4：扩展测试，覆盖临时文件与文件名安全。**

  添加两个测试：一个预先写入 `report.pdf.part` 后确认下一次路径为 `report (1).pdf`；另一个以 `../../secret.txt` 调用 `prepareDestination` 后断言返回路径仍位于月度目录内。

- [ ] **步骤 5：验证本任务。**

  运行：

  ```bash
  npm test -- test/storage.test.ts
  npm run typecheck
  ```

  预期：所有测试通过，且没有 TypeScript 错误。

### Task 3: 实现媒体描述、进度计算与下载编排

**文件：**
- 新建：`src/media.ts`
- 新建：`test/media.test.ts`
- 修改：`src/types.ts`

**接口：**
- 消费：`MediaDescriptor`、`PreparedDestination`、`prepareDestination`、`finalizeDownload`、`removeFileIfPresent`。
- 产出：`describeMedia`、`formatBytes`、`shouldReportProgress`、`downloadMediaToStorage`。
- 被后续任务使用：`bot.ts` 调用 `describeMedia` 和 `downloadMediaToStorage`。

- [ ] **步骤 1：为不依赖 GramJS 的纯媒体逻辑写失败测试。**

  在 `test/media.test.ts` 使用最小结构对象测试以下内容：

  ```ts
  it("为没有原始名称的照片生成 JPG 回退名称", () => {
    const item = describeMedia({ photo: { sizes: [] } }, new Date(2026, 7, 1, 2, 3, 4));
    expect(item).toMatchObject({ type: "图片", filename: "图片_20260801_020304.jpg" });
  });

  it("保留文档的原始文件名", () => {
    const item = describeMedia({ document: { fileName: "预算.xlsx", size: 1024 } }, new Date());
    expect(item).toMatchObject({ type: "文件", filename: "预算.xlsx", sizeBytes: 1024 });
  });

  it("仅在每增加 5% 或完成时更新进度", () => {
    expect(shouldReportProgress(-1, 1, 100)).toBe(false);
    expect(shouldReportProgress(0, 5, 100)).toBe(true);
    expect(shouldReportProgress(95, 100, 100)).toBe(true);
  });

  it("格式化字节大小", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });
  ```

- [ ] **步骤 2：运行媒体测试，确认失败。**

  运行：

  ```bash
  npm test -- test/media.test.ts
  ```

  预期：失败，提示媒体函数尚不存在。

- [ ] **步骤 3：实现媒体元数据与进度工具。**

  在 `src/media.ts` 实现：

  ```ts
  export function describeMedia(source: unknown, now: Date): MediaDescriptor | undefined;

  export function formatBytes(sizeBytes: number): string;

  export function shouldReportProgress(
    previouslyReportedPercent: number,
    downloadedBytes: number,
    totalBytes: number,
  ): boolean;
  ```

  `describeMedia` 必须识别照片、视频、文档、动图、音频、语音和视频消息；为没有名称的类型生成以下扩展名：照片 `.jpg`、视频 `.mp4`、动图 `.gif`、音频 `.mp3`、语音 `.ogg`、视频消息 `.mp4`。时间戳格式固定为 `YYYYMMDD_HHMMSS`，使用传入 `Date` 的本地日期。未知媒体返回 `undefined`。

  `formatBytes` 以 1024 为换算基数，按 `B`、`KB`、`MB`、`GB`、`TB` 选择单位并保留一位小数。`shouldReportProgress` 在总大小为零或未知时返回 `false`，在百分点比上次报告增加至少 5 或达到 100 时返回 `true`。

- [ ] **步骤 4：定义可替换的下载和状态接口，并为失败清理写测试。**

  在 `src/types.ts` 增加：

  ```ts
  export interface MediaDownloader {
    download(
      source: unknown,
      outputFile: string,
      onProgress: (downloadedBytes: number, totalBytes: number) => Promise<void>,
    ): Promise<void>;
  }

  export interface StatusReporter {
    update(text: string): Promise<void>;
  }
  ```

  在 `test/media.test.ts` 添加一个 fake downloader：它写入 `outputFile` 后抛出 `Error("network interrupted")`。调用下载编排函数后断言 promise 被拒绝，且 `${finalPath}.part` 不存在。再添加成功 fake downloader，断言最终路径存在、partial 路径不存在，并且状态文本至少包含 `✅`、最终绝对路径和 `1.0 KB`。

- [ ] **步骤 5：实现下载编排。**

  在 `src/media.ts` 实现：

  ```ts
  export async function downloadMediaToStorage(input: {
    descriptor: MediaDescriptor;
    root: string;
    now: Date;
    downloader: MediaDownloader;
    status: StatusReporter;
  }): Promise<{ finalPath: string; sizeBytes: number }>;
  ```

  实现顺序固定为：调用 `prepareDestination`；发送初始 `⬇️ 正在下载 <类型>...`；将下载器输出写到 `partialPath`；每次回调用 `shouldReportProgress` 决定是否调用 `status.update`，显示 10 格 `█`/`░` 进度条与 `formatBytes`；下载成功后读取 partial 文件大小、调用 `finalizeDownload`、发送包含 `✅`、类型、最终绝对路径和格式化大小的成功消息；任何失败都调用 `removeFileIfPresent(partialPath)` 后重新抛出原错误。

- [ ] **步骤 6：验证本任务。**

  运行：

  ```bash
  npm test -- test/media.test.ts
  npm run typecheck
  ```

  预期：媒体描述、进度、成功定稿和失败清理测试全部通过。

### Task 4: 创建不泄露密钥的轮转日志器

**文件：**
- 新建：`src/logger.ts`
- 新建：`test/logger.test.ts`

**接口：**
- 消费：`AppConfig.logging`。
- 产出：`createLogger(logging, cwd)`，返回 Winston `Logger`。
- 被后续任务使用：`index.ts` 和 `bot.ts` 将其作为唯一应用日志器。

- [ ] **步骤 1：写入会失败的日志器测试。**

  在 `test/logger.test.ts` 使用临时目录创建 logger，记录一条 `info("download completed", { path: "/store/2026/08/a.jpg" })`，等待 transport 完成后读取日志文件，断言包含 `download completed` 和路径。再记录 `{ token: "top-secret", apiHash: "hash-secret" }`，断言日志中不包含 `top-secret` 和 `hash-secret`。

- [ ] **步骤 2：运行日志器测试，确认失败。**

  运行：

  ```bash
  npm test -- test/logger.test.ts
  ```

  预期：失败，因为 `src/logger.ts` 不存在。

- [ ] **步骤 3：实现日志器。**

  在 `src/logger.ts` 导出：

  ```ts
  export interface LoggingOptions {
    fileName: string;
    maxBytes: number;
    backupCount: number;
  }

  export function createLogger(options: LoggingOptions, cwd: string): Logger;
  ```

  使用 Winston JSON 或带时间戳的文本格式，同时创建 Console transport 和 `new transports.File({ filename, maxsize, maxFiles })`。文件路径为 `resolve(cwd, options.fileName)`。实现格式转换，在写入前从 metadata 中剔除 `token`、`botToken`、`apiHash`、`TELEGRAM_BOT_TOKEN`、`TELEGRAM_API_HASH` 五个字段；其余上下文保留。

- [ ] **步骤 4：验证本任务。**

  运行：

  ```bash
  npm test -- test/logger.test.ts
  npm run typecheck
  ```

  预期：日志文件成功写入非敏感上下文，密钥字段被过滤。

### Task 5: 接入 GramJS、所有者过滤与 Telegram 状态消息

**文件：**
- 新建：`src/bot.ts`
- 新建：`test/authorization.test.ts`
- 修改：`src/types.ts`
- 修改：`src/media.ts`（仅当需要导出用于 handler 的类型）

**接口：**
- 消费：`AppConfig`、`Logger`、`describeMedia`、`downloadMediaToStorage`、`MediaDownloader`、`StatusReporter`。
- 产出：`isAuthorizedPrivateSender` 和 `startBot(config, logger)`。
- 被后续任务使用：`index.ts` 启动和停止 `BotRuntime`。

- [ ] **步骤 1：为授权守卫和静默忽略行为写失败测试。**

  在 `test/authorization.test.ts` 先测试纯守卫：

  ```ts
  import { isAuthorizedPrivateSender } from "../src/bot.js";

  it("仅接受私聊中的指定所有者", () => {
    expect(isAuthorizedPrivateSender({ isPrivate: true, senderId: "5744854503" }, "5744854503")).toBe(true);
    expect(isAuthorizedPrivateSender({ isPrivate: true, senderId: "1" }, "5744854503")).toBe(false);
    expect(isAuthorizedPrivateSender({ isPrivate: false, senderId: "5744854503" }, "5744854503")).toBe(false);
  });
  ```

  为可注入的消息路由函数添加 fake message：非所有者消息执行后断言没有调用 `reply`、`download` 或 logger 的 `info`；所有者 `/start` 消息执行后断言只回复中文帮助文案。

- [ ] **步骤 2：运行授权测试，确认失败。**

  运行：

  ```bash
  npm test -- test/authorization.test.ts
  ```

  预期：失败，提示 `isAuthorizedPrivateSender` 和路由函数不存在。

- [ ] **步骤 3：实现可测试的业务消息路由。**

  在 `src/bot.ts` 定义并导出：

  ```ts
  export interface IncomingMessage {
    isPrivate: boolean;
    senderId?: string;
    text?: string;
    source: unknown;
    reply(text: string): Promise<StatusReporter>;
  }

  export function isAuthorizedPrivateSender(
    message: Pick<IncomingMessage, "isPrivate" | "senderId">,
    ownerUserId: string,
  ): boolean;

  export function createMessageHandler(deps: {
    config: AppConfig;
    logger: Logger;
    now: () => Date;
    downloader: MediaDownloader;
  }): (message: IncomingMessage) => Promise<void>;
  ```

  `createMessageHandler` 的第一条逻辑必须是 `isAuthorizedPrivateSender`；失败时直接 `return`，不得调用回复、下载或日志。所有者发送精确 `/start` 时回复中文说明：可直接发送支持的媒体，文件会保存至本地月份目录。所有者发送不受支持消息时直接返回。所有者发送受支持媒体时先 `reply("⏳ 正在处理...")`，再调用 `downloadMediaToStorage`；捕获错误后仅回复 `❌ 下载失败，请稍后重试`，同时调用 `logger.error("media download failed", { error: error.message })`。不得把完整密钥、环境变量或非所有者消息内容写入日志。

- [ ] **步骤 4：实现 GramJS 适配层。**

  在同一模块实现：

  ```ts
  export interface BotRuntime {
    disconnect(): Promise<void>;
  }

  export async function startBot(config: AppConfig, logger: Logger): Promise<BotRuntime>;
  ```

  使用如下结构创建 GramJS 客户端：

  ```ts
  const client = new TelegramClient(
    new StringSession(""),
    config.telegram.apiId,
    config.telegram.apiHash,
    { connectionRetries: 5 },
  );
  await client.start({ botAuthToken: config.telegram.botToken });
  client.addEventHandler(onNewMessage, new NewMessage({ incoming: true }));
  ```

  在 `onNewMessage` 中将 GramJS message 适配为 `IncomingMessage`：私聊标记来自消息的私聊属性；sender ID 使用 Telegram Long 值的 `.toString()`；`reply` 调用 GramJS 回复方法并返回一个 `StatusReporter`，其 `update` 能编辑同一条状态消息；`MediaDownloader.download` 调用 GramJS `downloadMedia`，输出文件必须是传入的 `.part` 路径，并把下载回调的已下载/总字节数转发给业务层。若 `downloadMedia` 未产生文件则抛出明确的 `Error("Telegram 未返回下载文件")`。

  `BotRuntime.disconnect` 调用 GramJS 的断开方法。首次成功连接后记录 `bot connected`，不输出配置字段。

- [ ] **步骤 5：验证本任务。**

  运行：

  ```bash
  npm test -- test/authorization.test.ts
  npm run typecheck
  ```

  预期：授权与静默忽略测试通过，且 GramJS 接口在 TypeScript 编译期成立。

### Task 6: 组装入口、优雅退出与运行时错误边界

**文件：**
- 新建：`src/index.ts`
- 修改：`src/bot.ts`（如需向入口暴露 `BotRuntime`）
- 新建：`test/index.test.ts`

**接口：**
- 消费：`loadConfig`、`createLogger`、`startBot`、`BotRuntime`。
- 产出：`run()`；编译后的生产入口为 `dist/index.js`。

- [ ] **步骤 1：写入会失败的入口生命周期测试。**

  在 `test/index.test.ts` 以依赖注入方式测试 `run`：fake `startBot` 返回含 `disconnect` spy 的 runtime，fake process event registrar 捕获 `SIGINT` 和 `SIGTERM`。触发任一处理器后断言 `disconnect` 恰好调用一次，即使同一信号处理器被调用两次也不重复断开。

- [ ] **步骤 2：运行入口测试，确认失败。**

  运行：

  ```bash
  npm test -- test/index.test.ts
  ```

  预期：失败，因为入口模块或 `run` 尚不存在。

- [ ] **步骤 3：实现入口生命周期。**

  在 `src/index.ts` 导出：

  ```ts
  export async function run(deps?: {
    loadConfig: typeof loadConfig;
    createLogger: typeof createLogger;
    startBot: typeof startBot;
    onSignal: (signal: NodeJS.Signals, listener: () => void) => void;
  }): Promise<void>;
  ```

  默认依赖使用实际模块及 `process.once`。按顺序加载配置、创建日志器、记录 `telegram bot starting`、等待 `startBot`。注册 `SIGINT` 和 `SIGTERM`，用单个 `stopping` 布尔值保证 `runtime.disconnect()` 只执行一次；断开后记录 `telegram bot stopped` 并令 `process.exitCode = 0`，不要在 handler 中调用 `process.exit()`。模块最底部仅在它是主入口时调用 `run().catch(...)`；catch 必须将错误写到 stderr，并设置 `process.exitCode = 1`。

- [ ] **步骤 4：验证本任务。**

  运行：

  ```bash
  npm test -- test/index.test.ts
  npm run typecheck
  npm run build
  ```

  预期：生命周期测试、类型检查与生产编译全部通过，且产生 `dist/index.js`。

### Task 7: 提供 PM2 JSON 配置与中文运维文档

**文件：**
- 新建：`ecosystem.config.json`
- 新建：`README.md`
- 修改：`package.json`（仅在验证发现 script 与文档不一致时）

**接口：**
- 消费：构建入口 `dist/index.js`、固定项目目录 `/Users/sifon/docker/telegram-bot`、`.env.example`。
- 产出：可直接执行的 PM2 配置及中文部署说明。

- [ ] **步骤 1：创建 PM2 JSON 配置。**

  创建 `ecosystem.config.json`，内容严格为：

  ```json
  {
    "apps": [
      {
        "name": "telegram-bot",
        "cwd": "/Users/sifon/docker/telegram-bot",
        "script": "dist/index.js",
        "autorestart": true,
        "env": {
          "NODE_ENV": "production"
        }
      }
    ]
  }
  ```

- [ ] **步骤 2：编写中文 README。**

  `README.md` 必须包含以下可执行段落：

  1. 功能范围：仅所有者私聊下载、保存至 `DOWNLOAD_ROOT/YYYY/MM`、不上传阿里云盘。
  2. 前置条件：Node.js 20+、npm、全局安装的 PM2、Telegram 的 Bot Token/API ID/API Hash。
  3. 安装：`npm install`。
  4. 配置：`cp .env.example .env`，逐一解释每个变量；明确 `.env` 不应提交，当前暴露 Token 必须撤销重发。
  5. 验证：`npm run typecheck`、`npm test`、`npm run build`。
  6. 本地运行：`npm start`。
  7. PM2：

     ```bash
     npm run build
     pm2 start ecosystem.config.json
     pm2 status
     pm2 logs telegram-bot
     pm2 restart telegram-bot
     pm2 save
     pm2 startup
     ```

     说明 `pm2 startup` 会打印一条需要由用户自行使用适当权限执行的系统命令；修改 `.env` 或源码后必须重新构建，并以 `pm2 restart telegram-bot` 重启。
  8. 文件归档示例：2026 年 8 月的文件路径为 `/Users/sifon/docker/webdav/data/telegram/2026/08`。
  9. 排障：检查 WebDAV 根目录写权限、磁盘空间、`pm2 logs telegram-bot` 和本地 `bot.log`；说明非所有者没有收到响应是预期安全行为。

- [ ] **步骤 3：验证 JSON 和文档命令。**

  运行：

  ```bash
  node --input-type=module -e 'JSON.parse(await (await import("node:fs/promises")).readFile("ecosystem.config.json", "utf8")); console.log("PM2 JSON valid")'
  npm run typecheck
  npm test
  npm run build
  ```

  预期：输出 `PM2 JSON valid`，其他三个命令全部成功。

### Task 8: 进行真实 Telegram 媒体冒烟验证与交付检查

**文件：**
- 修改：`README.md`（仅记录测试中发现且已修正的、可复现的运行前置条件）

**接口：**
- 消费：全部构建产物、真实 `.env`、PM2 配置、WebDAV 本地路径。
- 产出：经过实际所有者消息验证的可管理 PM2 服务。

- [ ] **步骤 1：在不提交 `.env` 的前提下创建真实运行配置。**

  执行：

  ```bash
  cp .env.example .env
  ```

  由用户在 `.env` 中填写新撤销/重发后的 `TELEGRAM_BOT_TOKEN`、`TELEGRAM_API_ID` 和 `TELEGRAM_API_HASH`；保持 `OWNER_USER_ID=5744854503` 和既定的 `DOWNLOAD_ROOT`。实施者不得将真实值粘贴进终端记录、测试源码或 README。

- [ ] **步骤 2：完成自动化验证。**

  运行：

  ```bash
  npm run typecheck
  npm test
  npm run build
  ```

  预期：三条命令全部以退出码 0 完成。

- [ ] **步骤 3：启动 PM2 进程并用所有者账号测试下载。**

  运行：

  ```bash
  pm2 start ecosystem.config.json
  pm2 logs telegram-bot --lines 50
  ```

  从用户 ID `5744854503` 向机器人私聊发送一个小型、带原始名称的文档和一个没有原始名称的照片。确认：每条消息先出现处理中/下载进度状态；完成消息显示绝对路径与大小；文件分别出现在当前本地月份的 `DOWNLOAD_ROOT/YYYY/MM`；同名重发不会覆盖而是生成数字后缀。

- [ ] **步骤 4：验证非所有者静默与失败恢复。**

  使用另一个 Telegram 账号向机器人发送受支持媒体。确认：该账号没有收到回复，目标目录没有新文件，PM2 日志没有常规“下载开始”记录。随后发送一个无法下载或在测试期间撤回的媒体消息，确认所有者收到简洁失败提示、`.part` 文件被清理，并且下一条有效媒体仍能成功下载。

- [ ] **步骤 5：保存 PM2 进程列表并记录最终状态。**

  运行：

  ```bash
  pm2 save
  pm2 status
  ```

  预期：`telegram-bot` 状态为 `online`。若用户需要开机自动恢复，提示用户自行执行 `pm2 startup` 输出的那条系统命令；该命令可能需要交互式管理员权限，不应由代理代为猜测或执行。

## 计划自检

- **设计覆盖：** 配置与密钥由任务 1 覆盖；月度目录、冲突和临时文件由任务 2 覆盖；媒体类型、进度和下载完成/失败由任务 3 覆盖；轮转和密钥脱敏日志由任务 4 覆盖；GramJS、私聊和所有者静默过滤由任务 5 覆盖；退出恢复由任务 6 覆盖；PM2 JSON 与中文文档由任务 7 覆盖；真实下载、非所有者静默与 PM2 验收由任务 8 覆盖。阿里云、Docker、systemd 均未列入任何任务。
- **占位符扫描：** 本计划没有 `TODO`、`TBD`、"以后实现" 或未定义的相邻任务接口。所有核心逻辑任务都含有明确的测试、失败验证、实现要求和通过验证。
- **类型一致性：** `AppConfig` 在任务 1 定义并由任务 4、5、6 使用；`MediaDescriptor`、`MediaDownloader`、`StatusReporter` 在任务 2/3 定义并由任务 3、5 使用；`BotRuntime` 在任务 5 定义并由任务 6 使用；所有路径生成均通过任务 2 的 `prepareDestination`。
