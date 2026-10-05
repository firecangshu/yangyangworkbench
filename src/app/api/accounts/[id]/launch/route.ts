import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { appendFile, mkdir } from "fs/promises";
import { join } from "path";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";

/**
 * 账号启动（M9.8 卡内多号切换）：POST /api/accounts/:id/launch
 * 安全设计与连接卡启动完全一致：本路由不执行任何来自数据库/请求的命令字符串——
 * spawn 全字面量调起固定启动器；目标账号 id 经 /^\d+$/ 校验后以 `a<id>` 行写入
 * 启动队列，启动器据此查 ConnectionAccount 表并以 execFile(参数列表, shell:false) 执行。
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  if (!/^\d+$/.test(rawId)) {
    return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  }
  const account = await prisma.connectionAccount.findUnique({
    where: { id: Number(rawId) },
    include: { connection: true },
  });
  if (!account) return NextResponse.json({ error: "未找到" }, { status: 404 });
  if (!account.launchCommand.trim()) {
    return NextResponse.json({ error: "此账号未配置启动命令" }, { status: 400 });
  }

  try {
    await mkdir("scripts", { recursive: true });
    await appendFile(join("scripts", ".launch-queue"), `a${rawId}\n`, "utf-8");
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
      where: { id: account.connectionId },
      data: { lastUsedAt: new Date() },
    });
    await logEvent(tx, "connection_account", account.id, "launch", null, {
      toolName: account.connection.toolName,
      label: account.label,
      launchCommand: account.launchCommand,
    });
    return updated;
  });
  return NextResponse.json({ ok: true, toolName: updated.toolName, label: account.label });
}
