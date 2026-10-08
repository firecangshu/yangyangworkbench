import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { prisma } from "@/lib/db";
import { extractProfileDir, isUnderRoot, profileRoot } from "@/lib/launch-profile";

/*
 * 打开该号登录空间目录（M36.1）：POST /api/accounts/:id/folder
 * 目的很实在：要确认这个号有没有自己的登录态、或者想手动清掉它，得先看得见那个目录。
 * 安全边界与本路由其他动作一致：不执行任何命令字符串，spawn 固定用 explorer.exe，
 * 参数只有从库里命令反解出来的目录，而且必须先过 isUnderRoot——不在工作台登录空间
 * 根下的路径直接拒绝，免得一条脏命令把「打开目录」变成「打开用户私人文件夹」。
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  }
  const account = await prisma.connectionAccount.findUnique({ where: { id: Number(id) } });
  if (!account) return NextResponse.json({ error: "未找到" }, { status: 404 });

  const dir = extractProfileDir(account.launchCommand);
  if (!dir) {
    return NextResponse.json({ error: "这个号的命令里没有独立登录空间目录（手写的），没目录可开" }, { status: 400 });
  }
  if (!isUnderRoot(dir, profileRoot())) {
    return NextResponse.json({ error: `目录 ${dir} 不在工作台登录空间根下，为安全没有打开` }, { status: 400 });
  }
  if (!existsSync(dir)) {
    return NextResponse.json({ error: `这个号还没被启动过，目录 ${dir} 尚不存在` }, { status: 400 });
  }

  try {
    const child = spawn("explorer.exe", [dir], { shell: false, detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    child.on("error", () => {});
  } catch (e) {
    return NextResponse.json({ error: `打开失败：${String(e)}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true, dir });
}
