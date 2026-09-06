# Telegram Bot TypeScript 重写设计

**日期：** 2026-09-06  
**状态：** 设计已确认，等待书面设计审阅  
**目标目录：** `/Users/sifon/docker/telegram-bot`

## 1. 目标与范围

创建一个 TypeScript/Node.js 项目，替代现有的“Telegram 文件转存阿里云盘”机器人。新机器人接收已配置所有者私聊发送的受支持媒体文件，将其下载到本地，并按月份目录归档。

新项目必须满足：

- 使用 TypeScript 和 Node.js。
- 通过 GramJS 使用 Telegram MTProto 协议，保留约 2 GB 大文件下载能力。
- 将文件保存到 `/Users/sifon/docker/webdav/data/telegram/YYYY/MM`；年月以下载时服务器本地日期为准。
- 所有凭据和敏感配置均放在本地 `.env` 文件中。
- 仅处理 Telegram 用户 ID `5744854503` 的消息，其他人发送的消息必须静默忽略。
- 向所有者反馈下载进度、成功或失败结果。
- 通过 `ecosystem.config.json` 配置 PM2 进行生产环境进程管理。

## 2. 明确不做的内容

新的 TypeScript 机器人不会：

- 登录、上传或以其他方式连接阿里云盘。
- 依赖 `aligo`、扫码登录或开启阿里云盘登录端口。
- 提供 Docker 或 systemd 部署配置。
- 处理非所有者账号发送的媒体，也不会回复他们。
- 实现多用户权限、网页管理、云端同步或数据库。

旧的 Python 项目位于 `/Users/sifon/docker/aliyun-bot`，与新的目标目录独立；除非后续明确要求，否则本次迁移不会删除或修改它。

## 3. 运行架构

服务为一个独立的 Node.js 进程：

```text
Telegram MTProto
      │
      ▼
GramJS 客户端（使用 Bot Token 认证）
      │
      ├── 所有者与私聊消息校验
      ├── /start 命令处理器
      └── 已支持媒体处理器
              │
              ▼
       媒体下载服务
              │
              ▼
       按月份组织的本地存储
/Users/sifon/docker/webdav/data/telegram/YYYY/MM
```

### 建议项目结构

```text
telegram-bot/
├── src/
│   ├── index.ts           # 入口：配置、日志与客户端生命周期
│   ├── config.ts          # 加载与校验环境变量
│   ├── bot.ts             # GramJS 初始化、路由与授权校验
│   ├── media.ts           # 媒体元数据、进度与下载编排
│   ├── storage.ts         # 月度路径、安全文件名、目录与文件定稿
│   ├── logger.ts          # 控制台与轮转应用日志
│   └── types.ts           # 必要的共享类型
├── test/
│   ├── config.test.ts
│   ├── storage.test.ts
│   ├── authorization.test.ts
│   └── media.test.ts
├── .env.example
├── .gitignore
├── ecosystem.config.json
├── package.json
├── tsconfig.json
├── README.md
└── docs/superpowers/specs/
```

各模块将 Telegram 通信、授权、存储和配置职责分离，使纯逻辑能够在不连接 Telegram 的情况下测试。

## 4. 配置与密钥

服务启动时使用 `dotenv` 加载 `.env`，并在连接 Telegram 前校验配置。任何必填配置缺失或无效时，服务会拒绝启动并给出精确但不泄露敏感信息的错误。

仓库仅提交不含真实值的 `.env.example`：

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

规则如下：

- `TELEGRAM_API_ID` 必须是有效数字。
- `OWNER_USER_ID` 必须是正数形式的 Telegram 用户 ID。
- `DOWNLOAD_ROOT` 必须是绝对路径。
- 日志和错误信息绝不打印 Token、API Hash 或完整环境变量。
- `.env`、`node_modules`、日志、构建产物、Telegram 会话/缓存文件和未完成下载文件均写入 `.gitignore`。
- 当前已暴露的 Telegram Bot Token 必须在上线前撤销并重新生成；新 Token 只写入 `.env`。

## 5. 授权与消息处理

机器人保持当前仅处理私聊消息的范围。每一个收到的私聊更新都遵循以下流程：

1. 读取发送者的 Telegram 用户 ID。
2. 若该 ID 不等于 `OWNER_USER_ID`，立即返回：不回复、不下载、不创建目录，也不产生常规日志。
3. 若 ID 匹配，则将 `/start` 路由到简短帮助信息，将已支持媒体路由到下载流程。
4. 不支持的消息类型将被忽略，不回复错误信息。

支持的媒体类型包括：照片、视频、文档、动图/GIF、音频、语音消息和视频消息。

## 6. 下载与存储流程

每一条来自所有者的受支持媒体消息按以下步骤处理：

1. 发送 `⏳ 正在处理...` 状态消息。
2. 推导易读的媒体类型和文件名。Telegram 提供原始文件名时优先保留；未提供时生成合理的基于时间戳的回退名称。
3. 根据本地当前日期确定目标目录。例如，2026 年 8 月下载的文件保存至：

   ```text
   /Users/sifon/docker/webdav/data/telegram/2026/08
   ```

4. 目录不存在时递归创建。
5. 生成不会破坏已有数据的目标文件名。若目标名称已存在，则在扩展名前添加易读的数字后缀，例如 `report (1).pdf`；绝不覆盖已有文件。
6. 使用 GramJS/MTProto 将文件下载到目标目录内的临时后缀文件。每约 5% 更新一次 Telegram 状态消息，显示进度条和已传输/总大小。
7. 下载完整成功后，以原子重命名方式将临时文件变为最终文件；随后编辑状态消息，显示媒体类型、保存后的绝对路径和格式化后的大小。
8. 下载失败时，尽力删除未完成文件；向所有者发送简洁失败提示，并在本地记录完整错误上下文。随后继续处理之后的消息。

流程中没有临时文件上传到云端的环节，成功下载的文件也不会被自动删除。

## 7. 日志与优雅退出

应用日志会写入 stdout/stderr 和本地轮转日志文件。日志包含媒体类型、目标路径和错误类别等非敏感上下文，但不会包含任何密钥。

收到 `SIGINT` 或 `SIGTERM` 时，服务将停止接收新任务并主动断开 Telegram 连接。未完成的文件会保留为临时后缀文件，绝不会被错误标记为下载完成。

## 8. 构建、测试与 PM2 运维

项目以当前 Node.js LTS（Node.js 20 或更高版本）为目标，编译 TypeScript 至 `dist/`，并提供相当于下列功能的脚本：

- `npm run build`：编译生产 JavaScript。
- `npm run typecheck`：仅执行 TypeScript 类型检查，不产生输出文件。
- `npm test`：执行 Vitest 单元测试。
- `npm start`：在本地运行已构建的应用。

`ecosystem.config.json` 定义一个名为 `telegram-bot` 的 PM2 应用：

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

README 将说明以下生产环境流程：

```bash
npm install
cp .env.example .env
# 在 .env 中填写真实凭据
npm run build
pm2 start ecosystem.config.json
pm2 logs telegram-bot
pm2 save
pm2 startup
```

修改 `.env` 后，重启 PM2 进程即可让应用在启动时读取更新后的配置文件。

## 9. 测试策略与验收标准

Vitest 单元测试至少覆盖：

1. 必填配置缺失、格式不正确，以及存储路径不是绝对路径时的配置校验。
2. 授权判断，确保只有发送者 `5744854503` 可进入媒体处理流程。
3. 日期到目录的转换，确保生成预期的 `YYYY/MM` 层级。
4. 递归创建存储目录以及避免冲突的文件命名。
5. 回退媒体文件名、字节大小格式化和 5% 进度更新阈值。
6. 在可通过文件操作 mock 验证的范围内，验证临时下载文件的清理与最终定稿行为。

完成前必须执行：

```bash
npm run typecheck
npm test
npm run build
```

随后用真实 Telegram 媒体消息进行一次仅所有者可用的手工冒烟验证，确认最终文件位于正确的月度目录下，且非所有者消息不会得到任何回复。

## 10. 交付边界

交付内容为 `/Users/sifon/docker/telegram-bot` 中完整的 TypeScript 项目，包括源代码、测试、包元数据、安全配置模板、PM2 JSON 配置、中文文档；其中不包含任何阿里云盘集成。
