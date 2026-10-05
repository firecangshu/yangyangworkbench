import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { appendFile, mkdir } from "fs/promises";
import { join } from "path";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";

/**
 * 多账号启动卡（M9）：POST /api/connections/:id/launch
 * 启动已配置的桌面工具实例，不传凭据、不做登录。
 *
 * 安全设计：本路由不执行任何来自数据库/请求的命令字符串——
 * spawn 的命令与参数全部为字面量（固定启动器 scripts/launch-connection.mjs）；
 * 目标卡片 id 经 /^\d+$/ 校验后追加到启动队列文件，由启动器读取并以
 * execFile(参数列表, shell:false) 执行，不经 shell 解释。
 * 信任模型等同「开始菜单快捷方式」：启动器静态、可人工审查。
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  if (!/^\d+$/.test(rawId)) {
    return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  }
  const connection = await prisma.connection.findUnique({ where: { id: Number(rawId) } });
  if (!connection) return NextResponse.json({ error: "未找到" }, { status: 404 });
  if (!connection.launchCommand.trim()) {
    return NextResponse.json({ error: "此卡片未配置启动命令" }, { status: 400 });
  }

  try {
    await mkdir("scripts", { recursive: true });
    await appendFile(join("scripts", ".launch-queue"), `${rawId}\n`, "utf-8");
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

  const updated = await prisma.$transaction(async (tx) => {
    const updated = await tx.connection.update({
      where: { id: connection.id },
      data: { lastUsedAt: new Date() },
    });
    await logEvent(tx, "connection", connection.id, "launch", null, {
      toolName: connection.toolName,
      launchCommand: connection.launchCommand,
    });
    return updated;
  });
  return NextResponse.json({ ok: true, toolName: updated.toolName, launchCommand: updated.launchCommand });
}
