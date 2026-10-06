import { NextResponse } from "next/server";
import { copyFile, mkdir, readdir, stat, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";

const BACKUP_ROOT = path.join(process.cwd(), "backups");

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** POST = 执行一次备份；GET = 列出备份历史 */
export async function POST() {
  const [projects, contests, deliverables, contestProjects, connections, events] =
    await Promise.all([
      prisma.project.findMany(),
      prisma.contest.findMany({ include: { deliverables: true, links: true } }),
      prisma.deliverable.findMany(),
      prisma.contestProject.findMany(),
      prisma.connection.findMany(),
      prisma.eventLog.findMany(),
    ]);

  const snapshot = {
    exportedAt: new Date().toISOString(),
    counts: {
      projects: projects.length,
      contests: contests.length,
      deliverables: deliverables.length,
      contestProjects: contestProjects.length,
      connections: connections.length,
      events: events.length,
    },
    data: { projects, contests, deliverables, contestProjects, connections, events },
  };

  const dirName = `backup-${stamp()}`;
  const dir = path.join(BACKUP_ROOT, dirName);
  await mkdir(dir, { recursive: true });

  const jsonPath = path.join(dir, "snapshot.json");
  await writeFile(jsonPath, JSON.stringify(snapshot, null, 2), "utf-8");

  // 复制 SQLite 文件（Windows 下可复制被打开的 db）
  const dbSrc = path.join(process.cwd(), "prisma", "dev.db");
  const dbDst = path.join(dir, "workbench.db");
  let dbCopied = false;
  if (existsSync(dbSrc)) {
    await copyFile(dbSrc, dbDst);
    dbCopied = true;
  }

  await writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify({ dirName, createdAt: snapshot.exportedAt, counts: snapshot.counts, dbCopied }, null, 2),
    "utf-8"
  );

  // 流水：备份也记账（entityId=0 表示全局操作）
  await prisma.$transaction(async (tx) => {
    await logEvent(tx, "backup", 0, "create", null, { dirName, counts: snapshot.counts, dbCopied });
  });

  return NextResponse.json({ ok: true, dirName, path: dir, counts: snapshot.counts, dbCopied });
}

export async function GET() {
  if (!existsSync(BACKUP_ROOT)) return NextResponse.json([]);
  const entries = await readdir(BACKUP_ROOT, { withFileTypes: true });
  const result = [];
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.startsWith("backup-")) continue;
    const dir = path.join(BACKUP_ROOT, e.name);
    const manifestPath = path.join(dir, "manifest.json");
    let manifest: Record<string, unknown> = {};
    if (existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(await (await import("fs/promises")).readFile(manifestPath, "utf-8"));
      } catch { /* 忽略坏 manifest */ }
    }
    let sizeKB = 0;
    try {
      const files = await readdir(dir);
      for (const f of files) sizeKB += (await stat(path.join(dir, f))).size;
    } catch { /* ignore */ }
    result.push({ dirName: e.name, path: dir, sizeKB: Math.round(sizeKB / 1024), ...manifest });
  }
  result.sort((a, b) => (a.dirName < b.dirName ? 1 : -1));
  return NextResponse.json(result);
}
