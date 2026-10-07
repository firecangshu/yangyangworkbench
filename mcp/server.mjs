#!/usr/bin/env node
/**
 * ����̨ MCP Server
 * �� Claude / CodeBuddy / Loomy �� AI ���߾� MCP Э���ȡ����̨���ݡ�
 * ���ݷ��ʣ�ֱ�Ӷ� SQLite��node:sqlite������������������ Web �����Ƿ����ߡ�
 * ��ȫ�߽磺Ĭ��ֻ����add_event ��׷�ӱ�ע��ˮ���󶨱��� stdio��������˿ڡ�
 * ע�⣺SQL ����ʹ�����ݿ���ʵ������Prisma @map ��� snake_case����
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildContestInputPacket, phaseOf, PHASES } from "../cli/roadshow-core.mjs";
import { stat, readdir } from "node:fs/promises";

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
    description: "�г�����̨�еǼǵ�ȫ�� AI ������Ŀ�����ơ�·�������״̬����ǩ��",
    inputSchema: {
      status: z.string().optional().describe("��ѡ����״̬���ˣ�incubating/dev/submitted/maintain/done"),
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
    description: "�� id ��ȡ������Ŀ�������Ǽ���Ϣ",
    inputSchema: {
      id: z.number().describe("��Ŀ id"),
    },
  },
  async ({ id }) => {
    const db = openDb();
    try {
      const row = db.prepare("SELECT * FROM Project WHERE id = ?").get(id);
      if (!row) return { content: [{ type: "text", text: JSON.stringify({ error: "δ�ҵ�", id }) }] };
      return { content: [{ type: "text", text: JSON.stringify(row, null, 2) }] };
    } finally {
      db.close();
    }
  }
);

server.registerTool(
  "list_contests",
  {
    description: "�г�����̨�еǼǵ�ȫ������������ֹ�ա�״̬���������ȡ�������Ŀ��",
    inputSchema: {
      status: z.string().optional().describe("��ѡ����״̬���ˣ�research/registered/preparing/submitted/won/lost/cancelled"),
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
    description: "����̨������ˮ׷��һ����ע�¼������� AI ���߸ɻ������չ��ֻ׷�Ӳ��޸ģ�",
    inputSchema: {
      entityType: z.string().describe("�������ͣ��� project/contest/note"),
      entityId: z.number().describe("���� id��ȫ�ֱ�ע�� 0"),
      action: z.string().describe("���������� progress_note"),
      note: z.string().describe("��ע����"),
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
      "Ϊĳ���������ɺڿ���·��ħ��ʦ�� S1 �������Markdown�������ܱ�����Ϣ+������Ŀ������+���׶δ��������ɱ�������ǰ�ȵ�������ȡ�����ġ�",
    inputSchema: {
      contestId: z.number().describe("���� id"),
      stage: z
        .enum(PHASES)
        .optional()
        .describe("Ŀ��׶Σ�ȱʡ������ status �Զ��ƶ�"),
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
      if (!c) return { content: [{ type: "text", text: JSON.stringify({ error: "δ�ҵ�", contestId }) }] };
      const projects = db
        .prepare(
          "SELECT p.name, p.path, p.summary, p.tags, p.last_note AS lastNote FROM ContestProject cp JOIN Project p ON p.id = cp.project_id WHERE cp.contest_id = ?"
        )
        .all(contestId);
      const phase = stage ?? phaseOf(c.status);
      if (!PHASES.includes(phase))
        return { content: [{ type: "text", text: JSON.stringify({ error: `stage ��Ϊ��${PHASES.join("/")}` }) }] };
      const packet = buildContestInputPacket(c, projects, phase);
      return { content: [{ type: "text", text: packet }] };
    } finally {
      db.close();
    }
  }
);

const EXCLUDED_DIRS = new Set([
  "System Volume Information", "$RECYCLE.BIN", "node_modules", ".git", ".next",
  "backups", "credentials", "yangyangworkbench",
]);

server.registerTool(
  "sync_projects",
  {
    description: "刷新匹配：检查台账与磁盘一致性。返回健康/丢失/新增三类结果（只读，不写库）。",
    inputSchema: {},
  },
  async () => {
    const db = openDb();
    try {
      const projects = db.prepare("SELECT id, name, path FROM Project").all();
      const registeredPaths = new Set(projects.map((p) => p.path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()));
      const healthy = [], missing = [];
      for (const p of projects) {
        try { await stat(p.path); healthy.push({ id: p.id, name: p.name, path: p.path }); }
        catch { missing.push({ id: p.id, name: p.name, path: p.path }); }
      }
      const newDirs = [];
      try {
        const entries = await readdir("E:\\", { withFileTypes: true });
        for (const e of entries) {
          if (!e.isDirectory() || EXCLUDED_DIRS.has(e.name) || e.name.startsWith(".")) continue;
          const fp = `E:\\${e.name}`;
          if (!registeredPaths.has(fp.replace(/\\/g, "/").toLowerCase())) newDirs.push({ name: e.name, path: fp });
        }
      } catch {}
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            scannedAt: new Date().toISOString(), total: projects.length,
            summary: { healthyCount: healthy.length, missingCount: missing.length, newCount: newDirs.length },
            healthy, missing, newDirs,
          }, null, 2),
        }],
      };
    } finally {
      db.close();
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[yangyangworkbench-mcp] ready, db=" + DB_PATH);
