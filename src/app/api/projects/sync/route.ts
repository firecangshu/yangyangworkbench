import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { stat, readdir } from "fs/promises";
import { logEvent } from "@/lib/events";

// 排除的系统目录（E 盘根目录下非项目文件夹）
const EXCLUDED_DIRS = new Set([
  "System Volume Information",
  "$RECYCLE.BIN",
  "node_modules",
  ".git",
  ".next",
  "backups",
  "credentials",
  "yangyangworkbench", // 工作台自身
]);

/**
 * POST：执行刷新匹配
 * - 检查所有已登记项目的 path 是否在磁盘上存在
 * - 扫描 E 盘根目录，找出未登记的文件夹
 * - 返回 { healthy, missing, newDirs }
 */
export async function POST() {
  const projects = await prisma.project.findMany();
  const registeredPaths = new Set(projects.map((p) => normalizePath(p.path)));

  // 1) 检查已登记项目的存在性
  const healthy: { id: number; name: string; path: string }[] = [];
  const missing: { id: number; name: string; path: string }[] = [];

  for (const p of projects) {
    const exists = await pathExists(p.path);
    if (exists) {
      healthy.push({ id: p.id, name: p.name, path: p.path });
    } else {
      missing.push({ id: p.id, name: p.name, path: p.path });
    }
  }

  // 2) 扫描 E 盘根目录，找未登记的
  const newDirs: { name: string; path: string }[] = [];
  try {
    const entries = await readdir("E:\\", { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (EXCLUDED_DIRS.has(e.name)) continue;
      if (e.name.startsWith(".")) continue;
      const fullPath = `E:\\${e.name}`;
      if (!registeredPaths.has(normalizePath(fullPath))) {
        newDirs.push({ name: e.name, path: fullPath });
      }
    }
  } catch {
    // E 盘不可读时静默跳过
  }

  return NextResponse.json({
    scannedAt: new Date().toISOString(),
    total: projects.length,
    healthy,
    missing,
    newDirs,
    summary: {
      healthyCount: healthy.length,
      missingCount: missing.length,
      newCount: newDirs.length,
    },
  });
}

/**
 * PATCH：批量应用同步操作
 * body: { register: string[], markDone: number[] }
 * - register: 要登记的新目录路径列表（自动用目录名作项目名）
 * - markDone: 要标记为 done 的项目 id 列表（目录已丢失）
 */
export async function PATCH(req: Request) {
  const body = await req.json();
  const toRegister: string[] = body.register ?? [];
  const toMarkDone: number[] = body.markDone ?? [];

  const results = { registered: 0, markedDone: 0 };

  await prisma.$transaction(async (tx) => {
    // 登记新目录
    for (const dirPath of toRegister) {
      const name = dirPath.replace(/^E:\\/, "").split(/[\\/]/)[0];
      const exists = await pathExists(dirPath);
      if (!exists) continue;
      await tx.project.create({
        data: { name, path: dirPath, category: "other", status: "incubating" },
      });
      await logEvent(tx, "project", 0, "sync_register", "{}", JSON.stringify({ name, path: dirPath }));
      results.registered++;
    }

    // 标记丢失项目为 done
    for (const id of toMarkDone) {
      await tx.project.update({
        where: { id },
        data: { status: "done" },
      });
      await logEvent(tx, "project", id, "sync_mark_done", "{}", JSON.stringify({ reason: "directory_missing" }));
      results.markedDone++;
    }
  });

  return NextResponse.json({ ok: true, ...results });
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
