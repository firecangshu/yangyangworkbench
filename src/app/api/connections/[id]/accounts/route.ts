import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { buildAccountLaunch } from "@/lib/launch-profile";

/**
 * 卡内添加账号（M9.8 一卡多号，M36 加独立登录空间）。
 * 只填号名就能加号：启动命令由服务端生成（桌面工具沿用卡片 exe，网页平台交给本机浏览器），
 * 每个号拿到一个自己的 --user-data-dir，登录态存在那个目录里，工作台不碰密码。
 * 传了 launchCommand 则视为高级手写模式，按原样保存（与卡片默认命令同一套信任模型）。
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  }
  const body = await req.json();
  const label = String(body.label ?? "").trim();
  if (!label) return NextResponse.json({ error: "账号名称为必填项" }, { status: 400 });

  const connection = await prisma.connection.findUnique({ where: { id: Number(id) } });
  if (!connection) return NextResponse.json({ error: "未找到" }, { status: 404 });

  const handCmd = String(body.launchCommand ?? "").trim();
  let launchCommand = handCmd;
  let profileDir = "";
  let note = String(body.notes ?? "");

  if (!launchCommand) {
    const siblings = await prisma.connectionAccount.findMany({
      where: { connectionId: connection.id },
      select: { label: true },
    });
    const built = buildAccountLaunch({
      card: {
        toolName: connection.toolName,
        launchCommand: connection.launchCommand,
        entryUrl: connection.entryUrl,
      },
      label,
      existingLabels: siblings.map((s) => s.label),
    });
    // 生成不出来就如实报错，不建一个点开没反应的零命令号
    if (!built.ok) return NextResponse.json({ error: built.reason }, { status: 400 });
    launchCommand = built.cmd;
    profileDir = built.profileDir;
    if (!note.trim()) note = built.note;
    try {
      mkdirSync(built.profileDir, { recursive: true });
    } catch {
      /* 目录建不出来（例：E 盘没插）不影响保存命令，浏览器启动时会自己建 */
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const a = await tx.connectionAccount.create({
      data: {
        connectionId: connection.id,
        label,
        launchCommand,
        notes: note,
      },
    });
    await logEvent(tx, "connection_account", a.id, "create", null, {
      connectionId: connection.id,
      toolName: connection.toolName,
      label,
      launchCommand: a.launchCommand,
    });
    return a;
  });
  return NextResponse.json({ ...created, profileDir, auto: !handCmd }, { status: 201 });
}
