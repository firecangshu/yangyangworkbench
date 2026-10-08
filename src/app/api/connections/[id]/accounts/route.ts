import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { buildAccountLaunch, type LoginMode } from "@/lib/launch-profile";

/**
 * 卡内添加账号（M9.8 一卡多号，M36 独立登录空间，M36.3 登录态来源分叉）。
 * 只填号名就能加号：启动命令由服务端生成（桌面工具沿用卡片 exe，网页平台交给本机浏览器）。
 * M36.3 的规则：卡上第一个号直接复用本机已有的登录态（不用重登），
 * 第二个号起才分一份 --user-data-dir（同身份再开一个浏览器没意义，隔开才是切号）。
 * 前端可以显式指定 mode，不指定则由服务端按已有号数定，不能让自由文本从前端流进来。
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

  // 只认两个字面量，其余一律回到服务端推断，不给前端塞自定义串的机会
  const wantMode: LoginMode | undefined =
    body.mode === "reuse" || body.mode === "isolated" ? body.mode : undefined;

  const handCmd = String(body.launchCommand ?? "").trim();
  let launchCommand = handCmd;
  let profileDir = "";
  let mode: LoginMode | "hand" = handCmd ? "hand" : "reuse";
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
      mode: wantMode,
    });
    // 生成不出来就如实报错，不建一个点开没反应的零命令号
    if (!built.ok) return NextResponse.json({ error: built.reason }, { status: 400 });
    launchCommand = built.cmd;
    profileDir = built.profileDir;
    mode = built.mode;
    if (!note.trim()) note = built.note;
    try {
      // 只有独立空间需要建目录；复用模式不分目录，本来也就不该创一个空东西
      if (profileDir) mkdirSync(profileDir, { recursive: true });
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
  return NextResponse.json({ ...created, profileDir, mode, auto: !handCmd }, { status: 201 });
}
