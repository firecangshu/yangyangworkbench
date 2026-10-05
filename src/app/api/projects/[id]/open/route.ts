import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { existsSync, statSync } from "fs";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";

/**
 * 打开已注册项目的本地目录。
 * 安全边界：路径必须存在于 projects 表中，且为真实存在的目录。
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id: Number(id) } });
  if (!project) return NextResponse.json({ error: "未找到" }, { status: 404 });

  const dir = project.path;
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return NextResponse.json({ error: `路径不存在或不是目录: ${dir}` }, { status: 404 });
  }

  // Windows: explorer 打开目录（不经过 shell 拼接，参数数组传递）
  execFile("explorer.exe", [dir], { windowsHide: true }, () => {
    // explorer 正常情况也可能返回非 0 退出码，忽略
  });

  await prisma.$transaction(async (tx) => {
    await logEvent(tx, "project", project.id, "open_dir", null, { path: dir });
  });

  return NextResponse.json({ ok: true, path: dir });
}
