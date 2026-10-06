---
name: yangyangworkbench-connector
description: 雀�?AI 创作工作台通用接入。当用户询问"我有哪些项目/比赛/工具"�?帮我登记项目或比�?�?查工作台数�?�?更新项目状�?时使用。通过 REST API / MCP / CLI / 网页四通道访问本机工作台，返回真实台账数据�?---

# 工作台（Workbench）通用接入

工作台是用户本机�?AI 创作工作台：统一登记 AI 项目、比赛、工具连接，所有操作有 append-only 流水。任何智能体按下面三通道之一接入�?
## 前置检�?
```
GET http://localhost:3000/api/projects
```

- 返回 JSON（含 projects 数组）→ Web 服务在线，走通道 A/B
- 连接失败 �?工作台未启动。提示用户在 `E:\Documents\Loomy Workspace\工作台\工作台` 执行 `npm run dev`；或改走通道 B/D（直�?SQLite，无需 Web 服务�?
## 通道 A：REST API（最通用，推荐）

Base：`http://localhost:3000`。请求体与响应均�?JSON，UTF-8�?
| 方法 | 路径 | 作用 |
|------|------|------|
| GET | /api/projects | 全部项目（含状�?路径/标签�?|
| GET | /api/projects/:id | 单个项目 |
| POST | /api/projects | 注册项目（body: name, path 必填；category/status/summary/tags 可选） |
| PATCH | /api/projects/:id | 改项目（可改 status/name/summary/tags/lastNote 等） |
| DELETE | /api/projects/:id | 删项目登记（不动磁盘文件�?|
| POST | /api/projects/:id/open | 在资源管理器打开项目目录 |
| GET | /api/contests | 全部比赛（含交付物进度与关联项目�?|
| POST | /api/contests | 登记比赛（body: name 必填�?|
| PATCH | /api/contests/:id | 改比赛（status/deadline/notes 等） |
| DELETE | /api/contests/:id | 删比赛登�?|
| POST | /api/contests/:id/deliverables | 添加交付物（body: name 必填；stage/path/done 可选，done=true 自动�?doneAt�?|
| PATCH | /api/deliverables/:id | 勾选交付物（body: done: true/false�?|
| DELETE | /api/deliverables/:id | 删交付物 |
| POST | /api/contests/:id/link | 关联项目（body: projectId�?|
| DELETE | /api/contests/:id/link | 解除关联（body: projectId�?|
| GET | /api/sops | SOP 流程模板库（含步骤） |
| POST | /api/sops | 建模板（body: name 必填，steps 为字符串或数组） |
| PATCH / DELETE | /api/sops/:id | �?删模�?|
| POST | /api/contests/:id/apply-sop | 套用模板生成交付物（body: sopId，同名跳过） |
| POST | /api/contests/:id/roadshow-input | 生成魔术�?S1 输入包（body: `{launch?:bool}` 可空；返�?`{packet, phase}`，launch=true 顺带调起 Studio�?|
| POST | /api/connections/:id/credential-open | 定位凭据引用（explorer 打开引用的路�?URL，不取值） |
| GET | /api/connections | 全部工具连接卡片（含卡内账号条目�?|
| POST | /api/connections | 添加工具卡片 |
| POST | /api/connections/:id/launch | 启动多账号桌面工具（launchCommand 本机 spawn，不存凭据） |
| POST | /api/connections/:id/accounts | 卡内添加账号条目（label 必填，launchCommand 可选） |
| PATCH | /api/accounts/:id | 改账号条目（label/launchCommand/notes�?|
| DELETE | /api/accounts/:id | 删账号条�?|
| POST | /api/accounts/:id/launch | 启动指定账号（队�?a 前缀，同一安全链路�?|
| GET | /api/events | 最�?200 条操作流�?|
| GET | /api/scan/drive | E 盘编号目录体检（只读） |

写操作示例（登记项目）：

```
POST /api/projects
Content-Type: application/json

{"name":"新项�?,"path":"E:\\xx.新项�?,"category":"skill","status":"incubating"}
```

## 通道 B：MCP（stdio，无需 Web 服务�?
配置片段（粘贴到任意 MCP 客户端的 mcp.json）：

```json
{
  "mcpServers": {
    "Workbench": {
      "command": "node",
      "args": ["E:\\Documents\\Loomy Workspace\\工作台\\yangyangworkbench\\mcp\\server.mjs"]
    }
  }
}
```

五个工具：`list_projects`（可�?status 过滤）、`get_project`（id）、`list_contests`（可�?status）、`add_event`（entityType/entityId/action/note，回填进展备注）、`build_roadshow_input`（contestId + 可�?stage，生成比赛材料前先取上下文）�?server 直读 `prisma/dev.db`，Web 服务关着也能查�?
## 通道 C：网页（人工�?
`http://localhost:3000` �?仪表�?/ 项目中枢（表�?看板�? 比赛追踪（列�?日历+甘特�? 连接中心 / 操作流水 / 设置（备�?MCP 配置+云端测试+体检+主题）�?
## 通道 D：CLI（任何智能体，推荐接管用�?
```bash
node "E:\Documents\Loomy Workspace\工作台\工作台\cli\Workbench.mjs" <命令>
```

零依�?node 脚本，直�?`prisma/dev.db`�?*无需 dev server 在跑**；输�?JSON（UTF-8）；所有写操作在事务内追加流水（动作名�?Web API 一致）�?
| 命令 | 作用 |
|------|------|
| `list-projects [--status s]` | 项目清单 |
| `get-project <id>` | 单项目详�?|
| `add-project --name X --path Y [--category c] [--status s] [--tags t] [--summary s]` | 注册项目（name/path 必填�?|
| `update-project <id> [--name\|--path\|--category\|--status\|--tags\|--summary\|--last-note 值]` | 改项�?|
| `delete-project <id>` | 删台账行（磁盘文件永不动�?|
| `list-contests [--status s]` | 比赛清单（含交付进度/关联�?|
| `get-contest <id>` | 单比赛详情（含交付物与关联项目） |
| `add-contest --name X [--organizer o] [--track t] [--start-date d] [--deadline d] [--result-date d] [--status s] [--notes n]` | 登记比赛 |
| `update-contest <id> [--status\|--deadline\|--result-date\|--name\|--organizer\|--track\|--start-date\|--submit-link\|--notes 值]` | 改比�?|
| `delete-contest <id>` | 删比赛台�?|
| `add-deliverable <contestId> --name X` | 加交付物 |
| `set-deliverable <id> [--done true\|false] [--name X]` | 勾�?改交付物（勾选自动记 doneAt�?|
| `delete-deliverable <id>` | 删交付物 |
| `link <contestId> --project <projectId>` | 比赛↔项目关�?|
| `unlink <contestId> --project <projectId>` | 解除关联 |
| `connections` | 工具连接清单（只读） |
| `list-sops` | SOP 流程模板�?|
| `apply-sop <contestId> --sop <templateId>` | 套用模板生成交付物（同名跳过�?|
| `roadshow-input <contestId> [--stage phase]` | 生成魔术�?S1 输入包（--stage 缺省�?status 推断；输出含 packet�?|
| `events [--limit N]` | 最�?N 条操作流水（默认 20�?|
| `help` | 帮助 |

示例（接管式更新项目状态）�?
```bash
node "E:\Documents\Loomy Workspace\工作台\工作台\cli\Workbench.mjs" list-projects
node "E:\Documents\Loomy Workspace\工作台\工作台\cli\Workbench.mjs" update-project 3 --status submitted --last-note "已提�?GOSIM"
```

## 生成比赛材料前先取上下文（M30�?
要为某场比赛产出魔术师的 19 种路演材料（PPT/演讲�?路演�?海报/社媒文案…）时，**先取输入包，别反问用�?*——输入包已汇总比赛信�?+ 关联项目路径/摘要 + 本阶段待办产物�?
三通道取同一�?packet（语义等价）�?
- REST：`POST /api/contests/:id/roadshow-input`（body 可传 `{"launch":true}` 顺带调起本机 Studio）→ `{packet, phase}`
- MCP：`build_roadshow_input {contestId, stage?}` �?直接返回 packet 文本
- CLI：`node cli/Workbench.mjs roadshow-input <id> [--stage research|register|prepare|submit|result]` �?JSON �?`packet` 字段

`stage` 缺省按比�?`status` 推断（research→research / registered→register / preparing→prepare / submitted→submit / won|lost→result）。拿�?packet 后把它喂给路演魔术师（或直接产出），再把产物路径/完成态登记回该场比赛的交付物（REST `POST /api/contests/:id/deliverables` 支持 `name/stage/path/done`；CLI `add-deliverable`+`set-deliverable`）�?
## 数据约定

- 项目 status：`incubating | dev | submitted | maintain | done`（孵化中/开发中/已提�?维护�?完结�?- 项目 category：`skill | product | contest | patent | other`
- 比赛 status：`research | registered | preparing | submitted | won | lost | cancelled | expired`（expired = 截止日已过且未提交，2026-10-04 新增�?- 截止日格�?`yyyy-MM-dd`，空字符�?= 待定（不脑补日期�?- 交付�?done 勾选后自动�?doneAt

## 安全边界（必须遵守）

1. 凭据不入库：工具连接只存 credentialRef（路径引用），绝不写密码/API key 进雀�?2. 删登�?�?删文件：DELETE 只删台账行，磁盘文件永远不动
3. 体检只读�?api/scan/drive 只报告，无删除能�?4. 所有写操作自动�?/api/events 流水，改前改后可回溯
