# 杨杨的工作台

本地优先的 AI 创作项目 / 比赛 / 工具中枢。**M1-M4 全部交付**。

## 功能一览

| 模块 | 能力 |
|------|------|
| 项目中枢 | 项目注册 / 状态流转 / 一键打开目录（8 个真实项目） |
| 比赛追踪 | 倒计时 / 交付物勾选 / 项目多对多关联（7 场真实比赛） |
| 连接中心 | 10 个 AI 工具卡片 / 一键跳转 / 凭据引用（无密码字段） |
| 操作流水 | 所有写操作 append-only 事件日志（借鉴 Apache Maka） |
| 备份 | 一键导出 JSON 快照 + SQLite 副本到 `backups/` |
| MCP 对外 | AI 工具经 MCP 查询项目/比赛、回填备注（stdio 本地管道） |
| 云端调用 | key 走本地凭据文件引用，不入库不回传 |
| 目录体检 | E 盘编号目录只读扫描：同号重复 / 乱码检测 |

## 快速开始

```powershell
cd yangyangworkbench
npm install
npm run db:push
npm run db:seed          # 项目种子
npx tsx prisma/seed-contests.ts      # 比赛种子
npx tsx prisma/seed-connections.ts   # 连接种子
npm run dev              # http://localhost:3000
```

## MCP 接入（让 Claude / CodeBuddy 等查工作台数据）

把下面片段粘贴到 AI 工具的 MCP 配置：

```json
{
  "mcpServers": {
    "yangyangworkbench": {
      "command": "node",
      "args": ["E:\\Documents\\Loomy Workspace\\工作台\\yangyangworkbench\\mcp\\server.mjs"]
    }
  }
}
```

四个工具：`list_projects` / `get_project` / `list_contests` / `add_event`。
stdio 本地管道、无网络端口；只读为主，`add_event` 仅追加备注。

验证：`node mcp/smoke-test.mjs`（期望输出 `MCP_SMOKE_PASS`）。

## 设计原则

1. **本地优先**：SQLite 单文件，断网可用
2. **密码不入库**：凭据只存 vault/本地文件引用路径
3. **事件日志**：所有写操作 append-only 流水，改前改后可回溯
4. **永不误伤磁盘**：只管台账，不删 E 盘任何真实文件；体检只读

## 数据库

- 文件：`prisma/dev.db`
- 表：`Project` `Contest` `Deliverable` `ContestProject` `Connection` `EventLog`
- 注意：SQL 直查时列名为 Prisma `@map` 后的 snake_case（如 `last_note` `contest_id`）

## 常用命令

| 命令 | 作用 |
|------|------|
| `npm run dev` | 启动开发服务 |
| `npm run db:push` | 同步数据库结构 |
| `npm run db:seed` | 项目种子数据 |
| `node mcp/server.mjs` | 直接启动 MCP server（stdio） |
| `node mcp/smoke-test.mjs` | MCP 协议联调测试 |
