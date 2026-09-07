# Telegram Bot

这是一个使用 TypeScript 编写的 Telegram 文件下载机器人。

## 功能范围

- 仅处理所有者的 Telegram 私聊下载请求。
- 下载的文件保存到 `DOWNLOAD_ROOT/YYYY/MM`，按下载日期归档。
- 不上传阿里云盘，也不包含 Aliyun、Docker 或 systemd 部署流程。
- 非所有者不会收到响应，这是预期的安全行为。

## 前置条件

- Node.js 20 或更高版本
- npm
- 全局安装的 PM2
- Telegram Bot Token、Telegram API ID 和 Telegram API Hash

请先从 Telegram 的 BotFather 获取 Bot Token，再从 <https://my.telegram.org> 获取 API ID 和 API Hash。

## 安装

在项目目录 `/Users/sifon/docker/telegram-bot` 中执行：

```bash
npm install
```

## 配置

复制环境变量模板，并在项目目录中编辑 `.env`：

```bash
cp .env.example .env
```

逐项填写以下变量：

| 变量 | 说明 |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | BotFather 为机器人签发的 Bot Token，用于登录 Telegram Bot API。 |
| `TELEGRAM_API_ID` | Telegram 应用的数字 API ID，从 <https://my.telegram.org> 获取。 |
| `TELEGRAM_API_HASH` | 与 API ID 配套的 Telegram API Hash，从 <https://my.telegram.org> 获取。 |
| `OWNER_USER_ID` | 允许使用机器人的所有者 Telegram 用户 ID，只接受该用户的私聊请求；填写纯数字。 |
| `DOWNLOAD_ROOT` | 文件归档根目录，必须是绝对路径；程序会在其下创建 `YYYY/MM` 月度目录。 |
| `LOG_FILE` | 日志文件名，默认值为 `bot.log`；相对路径以项目当前目录为基准。 |
| `LOG_MAX_BYTES` | 单个日志文件的最大字节数，默认值为 `10485760`（10 MiB）。 |
| `LOG_BACKUP_COUNT` | 保留的日志轮转文件数量，默认值为 `5`。 |

`.env` 含有凭据，不能提交到 Git。当前已经暴露的 Token 必须立即在 BotFather 撤销并重新生成，然后只把新 Token 写入本地 `.env`。API Hash 同样应按密钥处理，不要发布或提交。

## 验证

在启动机器人前运行：

```bash
npm run typecheck
npm run build
```

## 本地运行

完成配置并构建后，在项目目录执行：

```bash
npm start
```

## 使用 PM2 部署

`ecosystem.config.json` 使用固定项目目录 `/Users/sifon/docker/telegram-bot`，并启动构建入口 `dist/index.js`。先完成配置和构建，再执行：

```bash
npm run build
pm2 start ecosystem.config.json
pm2 status
pm2 logs telegram-bot
pm2 restart telegram-bot
pm2 save
pm2 startup
```

`pm2 startup` 会打印一条需要用户自行使用适当权限执行的系统命令；请阅读并按当前机器的权限要求执行该命令。修改 `.env` 或源码后必须重新构建，并使用 `pm2 restart telegram-bot` 重启，使变更生效。

## 文件归档示例

如果 `DOWNLOAD_ROOT` 设置为 `/Users/sifon/docker/webdav/data/telegram`，2026 年 8 月下载的文件会保存到：

```text
/Users/sifon/docker/webdav/data/telegram/2026/08
```

## 排障

1. 确认 `DOWNLOAD_ROOT` 对应的 WebDAV 根目录存在，并检查运行机器上的用户对该目录具有写权限。
2. 检查磁盘空间，确认下载过程中有足够空间写入文件和临时文件。
3. 查看 PM2 输出：

   ```bash
   pm2 logs telegram-bot
   ```

4. 同时检查本地 `bot.log`（或 `LOG_FILE` 配置的日志文件），确认配置错误、下载失败和权限错误的具体原因。
5. 如果非所有者没有收到响应，这是预期的安全行为，不表示机器人故障。
