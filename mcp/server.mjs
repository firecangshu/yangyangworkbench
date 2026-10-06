#!/usr/bin/env node
/**
 * 雀台 MCP Server
 * 供 Claude / CodeBuddy / Loomy 等 AI 工具经 MCP 协议读取雀台数据。
 * 数据访问：直接读 SQLite（node:sqlite，零依赖），不依赖 Web 服务是否在线。
 * 安全边界：默认只读；add_event 仅追加备注流水；绑定本机 stdio，无网络端口。
 * 注意：SQL 列名使用数据库真实列名（Prisma @map 后的 snake_case）。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildContestInputPacket, phaseOf, PHASES } from "../cli/roadshow-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "prisma", "dev.db");

function openDb() {
  return new DatabaseSync(DB_PATH, { readOnly: true });
}

function openDbWritable() {
  return new DatabaseSync(DB_PATH);
}

const server = new McpServer({
  name: "yangyangworkbench",
  version: "0.4.0",
});

server.registerTool(
  "list_projects",
  {
    description: "列出雀台中登记的全部 AI 创作项目（名称、路径、类别、状态、标签）",
    inputSchema: {
      status: z.string().optional().describe("可选，按状态过滤：incubating/dev/submitted/maintain/done"),
    },
  },
  async ({ status }) => {
    const db = openDb();
    try {
      const rows = status
        ? db.prepare("SELECT id, name, path, category, status, tags, last_note AS lastNote, updated_at AS updatedAt FROM Project WHERE status = ? ORDER BY updated_at DESC").all(status)
        : db.prepare("SELECT id, name, path, category, status, tags, last_note AS lastNote, updated_at AS updatedAt FROM Project ORDER BY updated_at DESC").all();
      return { content: [{ type: "text", text: JSON.stringify({ count: rows.length, projects: rows }, null, 2) }] };
    } finally {
      db.close();
    }
  }
);

server.registerTool(
  "get_project",
  {
    description: "按 id 获取单个项目的完整登记信息",
    inputSchema: {
      id: z.number().describe("项目 id"),
    },
  },
  async ({ id }) => {
    const db = openDb();
    try {
      const row = db.prepare("SELECT * FROM Project WHERE id = ?").get(id);
      if (!row) return { content: [{ type: "text", text: JSON.stringify({ error: "未找到", id }) }] };
      return { content: [{ type: "text", text: JSON.stringify(row, null, 2) }] };
    } finally {
      db.close();
    }
  }
);

server.registerTool(
  "list_contests",
  {
    description: "列出雀台中登记的全部比赛（含截止日、状态、交付进度、关联项目）",
    inputSchema: {
      status: z.string().optional().describe("可选，按状态过滤：research/registered/preparing/submitted/won/lost/cancelled"),
    },
  },
  async ({ status }) => {
    const db = openDb();
    try {
      const contests = status
        ? db.prepare("SELECT * FROM Contest WHERE status = ? ORDER BY updated_at DESC").all(status)
        : db.prepare("SELECT * FROM Contest ORDER BY updated_at DESC").all();
      for (const c of contests) {
        c.deliverables = db.prepare("SELECT id, name, done, done_at AS doneAt FROM Deliverable WHERE contest_id = ?").all(c.id);
        c.doneCount = c.deliverables.filter((d) => d.done).length;
        c.links = db.prepare(
          "SELECT p.id, p.name, p.status FROM ContestProject cp JOIN Project p ON p.id = cp.project_id WHERE cp.contest_id = ?"
        ).all(c.id);
      }
      return { content: [{ type: "text", text: JSON.stringify({ count: contests.length, contests }, null, 2) }] };
    } finally {
      db.close();
    }
  }
);

server.registerTool(
  "add_event",
  {
    description: "向雀台操作流水追加一条备注事件（用于 AI 工具干活后回填进展，只追加不修改）",
    inputSchema: {
      entityType: z.string().describe("对象类型，如 project/contest/note"),
      entityId: z.number().describe("对象 id，全局备注填 0"),
      action: z.string().describe("动作名，如 progress_note"),
      note: z.string().describe("备注内容"),
    },
  },
  async ({ entityType, entityId, action, note }) => {
    const db = openDbWritable();
    try {
      const ts = new Date().toISOString();
      db.prepare(
        "INSERT INTO EventLog (ts, entity_type, entity_id, action, before_json, after_json) VALUES (?, ?, ?, ?, '{}', ?)"
      ).run(ts, entityType, entityId, action, JSON.stringify({ note, source: "mcp" }));
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, ts, entityType, entityId, action }) }] };
    } finally {
      db.close();
    }
  }
);

server.registerTool(
  "build_roadshow_input",
  {
    description:
      "为某场比赛生成黑客松路演魔术师的 S1 输入包（Markdown）：汇总比赛信息+关联项目上下文+本阶段待办产物。生成比赛材料前先调本工具取上下文。",
    inputSchema: {
      contestId: z.number().describe("比赛 id"),
      stage: z
        .enum(PHASES)
        .optional()
        .describe("目标阶段，缺省按比赛 status 自动推断"),
    },
  },
  async ({ contestId, stage }) => {
    const db = openDb();
    try {
      const c = db
        .prepare(
          "SELECT id, name, organizer, track, start_date AS startDate, deadline, result_date AS resultDate, status, notes FROM Contest WHERE id = ?"
        )
        .get(contestId);
      if (!c) return { content: [{ type: "text", text: JSON.stringify({ error: "未找到", contestId }) }] };
      const projects = db
        .prepare(
          "SELECT p.name, p.path, p.summary, p.tags, p.last_note AS lastNote FROM ContestProject cp JOIN Project p ON p.id = cp.project_id WHERE cp.contest_id = ?"
        )
        .all(contestId);
      const phase = stage ?? phaseOf(c.status);
      if (!PHASES.includes(phase))
        return { content: [{ type: "text", text: JSON.stringify({ error: `stage 须为：${PHASES.join("/")}` }) }] };
      const packet = buildContestInputPacket(c, projects, phase);
      return { content: [{ type: "text", text: packet }] };
    } finally {
      db.close();
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[yangyangworkbench-mcp] ready, db=" + DB_PATH);
