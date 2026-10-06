#!/usr/bin/env node
/**
 * 雀台通用 CLI —�?任何智能体可接管（SKILL.md 通道 D�? *
 * 用法：node cli/workbench.mjs <命令> [参数]
 * 设计约束（与 Web API 同源红线）：
 *   1. 只动台账，永不触碰磁盘文�? *   2. 凭据不入库（connections 只读，无任何密码字段�? *   3. 所有写操作在同一事务内追�?append-only 事件流水（动作名�?Web API 一致）
 *   4. 截止日等无把握信息留�?= 待定，不脑补
 * 输出统一�?JSON（UTF-8）；出错输出 { "error": ... } 并以退出码 1 结束�? */
import { PrismaClient } from "@prisma/client";
import { buildContestInputPacket, phaseOf, PHASES } from "./roadshow-core.mjs";

const db = new PrismaClient();

const VALID_PROJECT_STATUS = ["incubating", "dev", "submitted", "maintain", "done"];
const VALID_PROJECT_CATEGORY = ["skill", "product", "contest", "patent", "other"];
const VALID_CONTEST_STATUS = ["research", "registered", "preparing", "submitted", "won", "lost", "cancelled", "expired"];

const projectJSON = (p) => ({
  id: p.id, name: p.name, path: p.path, category: p.category,
  status: p.status, summary: p.summary, tags: p.tags, lastNote: p.lastNote,
});
const contestJSON = (c) => ({
  id: c.id, name: c.name, organizer: c.organizer, track: c.track,
  startDate: c.startDate, deadline: c.deadline, resultDate: c.resultDate, status: c.status,
  submitLink: c.submitLink, notes: c.notes,
});
const deliverableJSON = (d) => ({
  id: d.id, contestId: d.contestId, name: d.name, done: d.done, doneAt: d.doneAt,
});

async function logEvent(tx, entityType, entityId, action, before, after) {
  await tx.eventLog.create({
    data: {
      entityType,
      entityId,
      action,
      beforeJson: JSON.stringify(before ?? {}),
      afterJson: JSON.stringify(after ?? {}),
    },
  });
}

function fail(msg, code = 1) {
  console.log(JSON.stringify({ error: msg }, null, 2));
  process.exit(code);
}

/* ---------- 参数解析：首个非 --key 词为命令，其余收�?opts ---------- */
const argv = process.argv.slice(2);
const command = argv.find((a) => !a.startsWith("--")) ?? "help";
const opts = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) {
    const key = argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
    opts[key] = val;
    if (val !== "true") i++;
  }
}
const num = (v, label) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) fail(`${label} 必须是正整数，收到：${v}`);
  return n;
};

function pickStrings(source, keys) {
  const out = {};
  for (const k of keys) {
    if (typeof source[k] === "string" && source[k].trim()) out[k] = source[k].trim();
  }
  return out;
}

/* ---------- 命令实现 ---------- */
const commands = {
  help() {
    console.log(`雀台通用 CLI（通道 D）—�?项目/比赛台账接管工具

项目�? list-projects [--status s] | get-project <id>
        add-project --name X --path Y [--category c] [--status s] [--tags t] [--summary s]
        update-project <id> [--name|--path|--category|--status|--tags|--summary|--last-note 值]
        delete-project <id>            # 只删台账行，磁盘文件永不�?比赛�? list-contests [--status s] | get-contest <id>
        add-contest --name X [--organizer o] [--track t] [--start-date d] [--deadline d] [--result-date d] [--status s] [--notes n]
        update-contest <id> [--status|--deadline|--result-date|--name|--organizer|--track|--start-date|--submit-link|--notes 值]
        delete-contest <id>
交付物：add-deliverable <contestId> --name X
        set-deliverable <id> [--done true|false] [--name X]     # 勾选自动记 doneAt
        delete-deliverable <id>
关联�? link <contestId> --project <projectId> | unlink <contestId> --project <projectId>
其他�? connections   # 工具连接清单（只读，凭据只有引用路径�?        events [--limit N]
        list-sops     # SOP 流程模板�?        apply-sop <contestId> --sop <templateId>   # 套用模板生成交付物（同名跳过�?比赛材料：roadshow-input <contestId> [--stage phase]   # 生成魔术�?S1 输入包（--stage 缺省�?status 推断�?状态枚举：项目 ${VALID_PROJECT_STATUS.join("/")}
          比赛 ${VALID_CONTEST_STATUS.join("/")}
所有输出为 JSON；写操作自动记入事件流水（events 可查）。`);
  },

  async "list-projects"() {
    const where = opts.status ? { status: opts.status } : {};
    const projects = await db.project.findMany({ where, orderBy: { updatedAt: "desc" } });
    console.log(JSON.stringify({ count: projects.length, projects: projects.map(projectJSON) }, null, 2));
  },

  async "get-project"(id) {
    const p = await db.project.findUnique({ where: { id: num(id, "项目 id") } });
    if (!p) fail(`项目 ${id} 未找到`, 2);
    console.log(JSON.stringify(projectJSON(p), null, 2));
  },

  async "add-project"() {
    const base = pickStrings(opts, ["name", "path"]);
    if (!base.name || !base.path) fail("--name �?--path 必填");
    const data = { ...base, category: "other", status: "incubating", summary: "", tags: "", lastNote: "" };
    if (opts.category) {
      if (!VALID_PROJECT_CATEGORY.includes(opts.category)) fail(`category 须为�?{VALID_PROJECT_CATEGORY.join("/")}`);
      data.category = opts.category;
    }
    if (opts.status) {
      if (!VALID_PROJECT_STATUS.includes(opts.status)) fail(`status 须为�?{VALID_PROJECT_STATUS.join("/")}`);
      data.status = opts.status;
    }
    for (const k of ["tags", "summary"]) if (opts[k]) data[k] = opts[k];
    const created = await db.$transaction(async (tx) => {
      const p = await tx.project.create({ data });
      await logEvent(tx, "project", p.id, "create", null, projectJSON(p));
      return p;
    });
    console.log(JSON.stringify({ ok: true, project: projectJSON(created) }, null, 2));
  },

  async "update-project"(id) {
    const pid = num(id, "项目 id");
    const data = pickStrings(opts, ["name", "path", "tags", "summary", "lastNote"]);
    if (opts.category) {
      if (!VALID_PROJECT_CATEGORY.includes(opts.category)) fail(`category 须为�?{VALID_PROJECT_CATEGORY.join("/")}`);
      data.category = opts.category;
    }
    if (opts.status) {
      if (!VALID_PROJECT_STATUS.includes(opts.status)) fail(`status 须为�?{VALID_PROJECT_STATUS.join("/")}`);
      data.status = opts.status;
    }
    if (Object.keys(data).length === 0) fail("无有效更新字�?);
    const updated = await db.$transaction(async (tx) => {
      const before = await tx.project.findUnique({ where: { id: pid } });
      if (!before) fail(`项目 ${pid} 未找到`, 2);
      const p = await tx.project.update({ where: { id: pid }, data });
      await logEvent(tx, "project", pid, "update", projectJSON(before), projectJSON(p));
      return p;
    });
    console.log(JSON.stringify({ ok: true, project: projectJSON(updated) }, null, 2));
  },

  async "delete-project"(id) {
    const pid = num(id, "项目 id");
    await db.$transaction(async (tx) => {
      const before = await tx.project.findUnique({ where: { id: pid } });
      if (!before) fail(`项目 ${pid} 未找到`, 2);
      await tx.project.delete({ where: { id: pid } });
      await logEvent(tx, "project", pid, "delete", projectJSON(before), null);
    });
    console.log(JSON.stringify({ ok: true, deleted: pid, note: "仅删台账行，磁盘文件未动" }, null, 2));
  },

  async "list-contests"() {
    const where = opts.status ? { status: opts.status } : {};
    const contests = await db.contest.findMany({
      where,
      orderBy: { deadline: "asc" },
      include: { deliverables: { orderBy: { id: "asc" } }, links: { include: { project: true } } },
    });
    console.log(JSON.stringify({
      count: contests.length,
      contests: contests.map((c) => ({
        ...contestJSON(c),
        deliverables: c.deliverables.map(deliverableJSON),
        projects: c.links.map((l) => ({ id: l.project.id, name: l.project.name })),
      })),
    }, null, 2));
  },

  async "get-contest"(id) {
    const c = await db.contest.findUnique({
      where: { id: num(id, "比赛 id") },
      include: { deliverables: { orderBy: { id: "asc" } }, links: { include: { project: true } } },
    });
    if (!c) fail(`比赛 ${id} 未找到`, 2);
    console.log(JSON.stringify({
      ...contestJSON(c),
      deliverables: c.deliverables.map(deliverableJSON),
      projects: c.links.map((l) => ({ id: l.project.id, name: l.project.name })),
    }, null, 2));
  },

  async "roadshow-input"(id) {
    const cid = num(id, "比赛 id");
    const c = await db.contest.findUnique({
      where: { id: cid },
      include: { links: { include: { project: true } } },
    });
    if (!c) fail(`比赛 ${id} 未找到`, 2);
    let phase = phaseOf(c.status);
    if (opts.stage) {
      if (!PHASES.includes(opts.stage)) fail(`--stage 须为�?{PHASES.join("/")}`);
      phase = opts.stage;
    }
    const projects = c.links.map((l) => ({
      name: l.project.name, path: l.project.path, summary: l.project.summary,
      tags: l.project.tags, lastNote: l.project.lastNote,
    }));
    const packet = buildContestInputPacket(c, projects, phase);
    console.log(JSON.stringify({ ok: true, contestId: cid, contestName: c.name, phase, packet }, null, 2));
  },

  async "add-contest"() {
    const name = (opts.name ?? "").trim();
    if (!name) fail("--name 必填");
    const data = { name, status: "research" };
    for (const k of ["organizer", "track", "startDate", "deadline", "resultDate", "notes", "submitLink"]) {
      if (opts[k]) data[k] = opts[k];
    }
    if (opts.status) {
      if (!VALID_CONTEST_STATUS.includes(opts.status)) fail(`status 须为�?{VALID_CONTEST_STATUS.join("/")}`);
      data.status = opts.status;
    }
    const created = await db.$transaction(async (tx) => {
      const c = await tx.contest.create({ data });
      await logEvent(tx, "contest", c.id, "create", null, contestJSON(c));
      return c;
    });
    console.log(JSON.stringify({ ok: true, contest: contestJSON(created) }, null, 2));
  },

  async "update-contest"(id) {
    const cid = num(id, "比赛 id");
    const data = pickStrings(opts, ["name", "organizer", "track", "startDate", "deadline", "resultDate", "submitLink", "notes"]);
    if (opts.status) {
      if (!VALID_CONTEST_STATUS.includes(opts.status)) fail(`status 须为�?{VALID_CONTEST_STATUS.join("/")}`);
      data.status = opts.status;
    }
    if (Object.keys(data).length === 0) fail("无有效更新字�?);
    const updated = await db.$transaction(async (tx) => {
      const before = await tx.contest.findUnique({ where: { id: cid } });
      if (!before) fail(`比赛 ${cid} 未找到`, 2);
      const c = await tx.contest.update({ where: { id: cid }, data });
      await logEvent(tx, "contest", cid, "update", contestJSON(before), contestJSON(c));
      return c;
    });
    console.log(JSON.stringify({ ok: true, contest: contestJSON(updated) }, null, 2));
  },

  async "delete-contest"(id) {
    const cid = num(id, "比赛 id");
    await db.$transaction(async (tx) => {
      const before = await tx.contest.findUnique({ where: { id: cid } });
      if (!before) fail(`比赛 ${cid} 未找到`, 2);
      await tx.contest.delete({ where: { id: cid } });
      await logEvent(tx, "contest", cid, "delete", contestJSON(before), null);
    });
    console.log(JSON.stringify({ ok: true, deleted: cid }, null, 2));
  },

  async "add-deliverable"(contestId) {
    const cid = num(contestId, "比赛 id");
    const name = (opts.name ?? "").trim();
    if (!name) fail("--name 必填");
    const contest = await db.contest.findUnique({ where: { id: cid } });
    if (!contest) fail(`比赛 ${cid} 未找到`, 2);
    const created = await db.$transaction(async (tx) => {
      const d = await tx.deliverable.create({ data: { contestId: cid, name } });
      await logEvent(tx, "deliverable", d.id, "create", null, { contestId: cid, name, done: false });
      return d;
    });
    console.log(JSON.stringify({ ok: true, deliverable: deliverableJSON(created) }, null, 2));
  },

  async "set-deliverable"(id) {
    const did = num(id, "交付�?id");
    const data = {};
    if (opts.name) data.name = opts.name;
    if (opts.done !== undefined) {
      if (!["true", "false"].includes(opts.done)) fail("--done 取�?true|false");
      data.done = opts.done === "true";
      data.doneAt = data.done ? new Date() : null;
    }
    if (Object.keys(data).length === 0) fail("无有效更新字�?);
    const updated = await db.$transaction(async (tx) => {
      const before = await tx.deliverable.findUnique({ where: { id: did } });
      if (!before) fail(`交付�?${did} 未找到`, 2);
      const d = await tx.deliverable.update({ where: { id: did }, data });
      await logEvent(tx, "deliverable", did, "update", deliverableJSON(before), deliverableJSON(d));
      return d;
    });
    console.log(JSON.stringify({ ok: true, deliverable: deliverableJSON(updated) }, null, 2));
  },

  async "delete-deliverable"(id) {
    const did = num(id, "交付�?id");
    await db.$transaction(async (tx) => {
      const before = await tx.deliverable.findUnique({ where: { id: did } });
      if (!before) fail(`交付�?${did} 未找到`, 2);
      await tx.deliverable.delete({ where: { id: did } });
      await logEvent(tx, "deliverable", did, "delete", deliverableJSON(before), null);
    });
    console.log(JSON.stringify({ ok: true, deleted: did }, null, 2));
  },

  async link(contestId) {
    const cid = num(contestId, "比赛 id");
    const pid = num(opts.project, "--project");
    const contest = await db.contest.findUnique({ where: { id: cid } });
    const project = await db.project.findUnique({ where: { id: pid } });
    if (!contest || !project) fail("比赛或项目不存在", 2);
    const result = await db.$transaction(async (tx) => {
      const exists = await tx.contestProject.findUnique({
        where: { contestId_projectId: { contestId: cid, projectId: pid } },
      });
      if (exists) return { dup: true };
      const link = await tx.contestProject.create({ data: { contestId: cid, projectId: pid } });
      await logEvent(tx, "contest_project", link.id, "create", null, {
        contestId: cid, contestName: contest.name, projectId: pid, projectName: project.name,
      });
      return { dup: false };
    });
    if (result.dup) fail("已关�?, 3);
    console.log(JSON.stringify({ ok: true, contestId: cid, projectId: pid }, null, 2));
  },

  async unlink(contestId) {
    const cid = num(contestId, "比赛 id");
    const pid = num(opts.project, "--project");
    await db.$transaction(async (tx) => {
      const link = await tx.contestProject.findUnique({
        where: { contestId_projectId: { contestId: cid, projectId: pid } },
      });
      if (!link) fail("未关�?, 2);
      await tx.contestProject.delete({ where: { id: link.id } });
      await logEvent(tx, "contest_project", link.id, "delete", { contestId: cid, projectId: pid }, null);
    });
    console.log(JSON.stringify({ ok: true, contestId: cid, projectId: pid }, null, 2));
  },

  async connections() {
    const rows = await db.connection.findMany({ orderBy: { id: "asc" } });
    console.log(JSON.stringify({ count: rows.length, connections: rows }, null, 2));
  },

  async "list-sops"() {
    const sops = await db.sopTemplate.findMany({
      orderBy: { id: "asc" },
      include: { steps: { orderBy: { sortOrder: "asc" } } },
    });
    console.log(JSON.stringify({
      count: sops.length,
      sops: sops.map((s) => ({ id: s.id, name: s.name, description: s.description, steps: s.steps.map((x) => x.name) })),
    }, null, 2));
  },

  async "apply-sop"(contestId) {
    const cid = num(contestId, "比赛 id");
    const sid = num(opts.sop, "--sop");
    const sop = await db.sopTemplate.findUnique({
      where: { id: sid },
      include: { steps: { orderBy: { sortOrder: "asc" } } },
    });
    if (!sop) fail(`SOP 模板 ${sid} 未找到`, 2);
    const contest = await db.contest.findUnique({ where: { id: cid } });
    if (!contest) fail(`比赛 ${cid} 未找到`, 2);
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.deliverable.findMany({ where: { contestId: cid }, select: { name: true } });
      const names = new Set(existing.map((d) => d.name));
      const createdNames = [];
      for (const step of sop.steps) {
        if (names.has(step.name)) continue;
        const d = await tx.deliverable.create({ data: { contestId: cid, name: step.name } });
        await tx.eventLog.create({
          data: {
            entityType: "deliverable", entityId: d.id, action: "create",
            beforeJson: JSON.stringify({}),
            afterJson: JSON.stringify({ contestId: cid, name: step.name, done: false, viaSop: sid }),
          },
        });
        createdNames.push(step.name);
      }
      await tx.eventLog.create({
        data: {
          entityType: "contest", entityId: cid, action: "apply_sop",
          beforeJson: JSON.stringify({}),
          afterJson: JSON.stringify({ sopId: sid, sopName: sop.name, created: createdNames.length, skipped: sop.steps.length - createdNames.length }),
        },
      });
      return { created: createdNames, skipped: sop.steps.length - createdNames.length };
    });
    console.log(JSON.stringify({ ok: true, sopName: sop.name, contestName: contest.name, ...result }, null, 2));
  },

  async events() {
    const limit = Math.min(Number(opts.limit) || 20, 200);
    const rows = await db.eventLog.findMany({ orderBy: { id: "desc" }, take: limit });
    console.log(JSON.stringify({ count: rows.length, events: rows }, null, 2));
  },
};

const handler = commands[command];
if (!handler) {
  fail(`未知命令�?{command}（node cli/workbench.mjs help 查看命令表）`);
}
try {
  await handler(command === "help" ? undefined : argv[argv.indexOf(command) + 1]);
} catch (e) {
  fail(String(e?.message ?? e));
} finally {
  await db.$disconnect();
}
