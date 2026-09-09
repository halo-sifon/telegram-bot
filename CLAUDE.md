# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
npm run dev        # 开发模式：直接运行 TypeScript,文件变更自动重启(tsx watch)
npm run typecheck  # 只做类型检查,不产出文件(tsc --noEmit)
npm run build      # 编译 src/ → dist/(tsc -p tsconfig.json)
npm start          # 运行编译产物 dist/main.js

# 生产环境(PM2):
npm run build && pm2 start ecosystem.config.json
pm2 logs telegram-bot
pm2 restart telegram-bot   # 修改源码或 .env 后必须重启(先重新 build)
```

项目**没有测试套件,也没有 linter**——Vitest 是用户明确要求删除的。验证手段就是 `npm run typecheck && npm run build`。

## 架构

单进程 Telegram 机器人:把所有者私聊中的媒体文件下载到本地按月归档目录(`DOWNLOAD_ROOT/YYYY/MM`)。无云上传,无 HTTP 服务。

请求链路:`main.ts`(可执行入口)→ `index.ts`(组装配置/日志/机器人,处理 SIGINT/SIGTERM 优雅退出)→ `bot.ts`(GramJS 边界层)→ `media.ts`(媒体识别 + 下载编排)→ `storage.ts`(文件系统)。

模块边界:

- **`bot.ts`** 是唯一直接接触 GramJS 类型的文件。它把 GramJS 原始事件适配成 `types.ts` 中的内部接口(`IncomingMessage` / `MediaDownloader` / `StatusReporter`),其余代码与具体库解耦。授权过滤在这里:只处理 `OWNER_USER_ID` 的私聊消息,其他用户和所有群组**静默忽略是刻意设计**,不是故障。
- **`media.ts`** 通过嗅探原始消息对象识别媒体类型(GramJS 字段名不统一:`fileName`/`file_name`、MIME 类型、document attributes 都要兼容),产出 `MediaDescriptor`。其中 `SupportedMediaType` 是中文字符串(图片/视频/文件/动图/音频/语音/视频消息),**会原样出现在用户可见的状态消息中**。同时负责下载编排:每 5% 编辑一次进度消息。
- **`storage.ts`** 负责"绝不覆盖已有文件"的保证:`prepareDestination` 用 `open(path, "wx")` 原子预留 `.part` 路径,`finalizeDownload` 用 `link` + `unlink` 而不是 `rename`——因为 POSIX `rename` 会静默覆盖同名文件。**不要把它改回 `rename`。**
- **`config.ts`** 启动时用 Zod 校验 `.env`,字段缺失或非法直接快速失败。`OWNER_USER_ID` **全程保持字符串**(Telegram 用户 ID 可能超出安全整数范围),与 `senderId.toString()` 用 `===` 比较,永远不要 `Number()` 转换。
- **`logger.ts`** 封装 Winston(控制台 + 轮转文件),format 会从每条日志中删除敏感字段(`token`、`apiHash` 等)。新增敏感字段时把它加进 `SECRET_FIELDS`。

## GramJS API 陷阱(来自一次生产 bug)

GramJS `Message` 的发送和编辑方法**参数名不同**:

- 发新消息:`message.reply({ message: text })`
- 编辑已有消息:`statusMessage.edit({ text })`——这里传 `message:` 会报 `You have to provide either file or text or schedule property`,因为 GramJS 会把 `message` 当作目标消息 ID 重新解释。

## 配置

`.env`(已 gitignore,绝不提交)存放 Telegram 凭据和 `OWNER_USER_ID` / `DOWNLOAD_ROOT`,模板见 `.env.example`。`ecosystem.config.json` 写死了项目绝对路径 `/Users/sifon/docker/telegram-bot`,运行编译产物 `dist/main.js`。
