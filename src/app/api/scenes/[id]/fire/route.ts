import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { appendFile, mkdir } from "fs/promises";
import { join } from "path";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";

/**
 * 场景一键并行启动（M17）：POST /api/scenes/:id/fire
 * 复用 M9 安全链路：本路由不执行任何来自数据库的命令字符串——
 * 把场景成员 id（connection 为纯数字、account 加 a 前缀）追加进 .launch-queue，
 * 由静态可审查的启动器逐条 execFile(shell:false) 执行，天然支持多程序并行。
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  const sceneId = Number(id);
  const scene = await prisma.launchScene.findUnique({
    where: { id: sceneId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!scene) return NextResponse.json({ error: "未找到" }, { status: 404 });
  if (scene.items.length === 0) return NextResponse.json({ error: "场景里还没有成员" }, { status: 400 });

  // 校验成员仍然有效（删过的卡/号跳过），生成队列行
  const lines: string[] = [];
  const fired: string[] = [];
  for (const it of scene.items) {
    if (it.kind === "account") {
      const acc = await prisma.connectionAccount.findUnique({ where: { id: it.refId } });
      if (acc && acc.launchCommand.trim()) {
        lines.push(`a${acc.id}`);
        fired.push(`account#${acc.id}`);
      }
    } else {
      const conn = await prisma.connection.findUnique({ where: { id: it.refId } });
      if (conn && conn.launchCommand.trim()) {
        lines.push(`${conn.id}`);
        fired.push(`connection#${conn.id}`);
      }
    }
  }
  if (lines.length === 0) return NextResponse.json({ error: "场景内没有可启动的成员（启动命令为空或已删除）" }, { status: 400 });

  try {
    await mkdir("scripts", { recursive: true });
    await appendFile(join("scripts", ".launch-queue"), lines.join("\n") + "\n", "utf-8");
    const child = spawn("node", ["scripts/launch-connection.mjs"], {
      shell: false,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    child.on("error", () => {});
  } catch (e) {
    return NextResponse.json({ error: `启动失败：${String(e)}` }, { status: 500 });
  }

  await prisma.$transaction(async (tx) => {
    for (const it of scene.items) {
      if (it.kind === "connection") {
        await tx.connection.updateMany({ where: { id: it.refId }, data: { lastUsedAt: new Date() } });
      } else {
        const acc = await tx.connectionAccount.findUnique({ where: { id: it.refId } });
        if (acc) await tx.connection.updateMany({ where: { id: acc.connectionId }, data: { lastUsedAt: new Date() } });
      }
    }
    await logEvent(tx, "launch_scene", sceneId, "fire", null, { name: scene.name, fired });
  });
  return NextResponse.json({ ok: true, name: scene.name, fired: fired.length });
}
