import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { appendFile, mkdir } from "fs/promises";
import { join } from "path";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";

/**
 * 凭据引用打开（M10.4）：POST /api/connections/:id/credential-open
 * 与启动卡同一安全链路：本路由不执行任何命令字符串——spawn 全字面量调起启动器，
 * id 经 /^\d+$/ 校验后以 `c<id>` 行入队，启动器读取 credential_ref（只存引用不存值）
 * 并以 explorer 定位到引用的文件/目录/URL。
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
  if (!connection.credentialRef.trim()) {
    return NextResponse.json({ error: "此卡片未配置凭据引用" }, { status: 400 });
  }

  try {
    await mkdir("scripts", { recursive: true });
    await appendFile(join("scripts", ".launch-queue"), `c${rawId}\n`, "utf-8");
    const child = spawn("node", ["scripts/launch-connection.mjs"], {
      shell: false,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    child.on("error", () => {});
  } catch (e) {
    return NextResponse.json({ error: `打开失败：${String(e)}` }, { status: 500 });
  }

  await prisma.$transaction(async (tx) => {
    await logEvent(tx, "connection", connection.id, "credential_open", null, {
      toolName: connection.toolName,
      credentialRef: connection.credentialRef,
    });
  });
  return NextResponse.json({ ok: true, toolName: connection.toolName, credentialRef: connection.credentialRef });
}
