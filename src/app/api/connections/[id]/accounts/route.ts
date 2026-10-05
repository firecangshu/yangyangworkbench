import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";

/** 卡内添加账号（M9.8 一卡多号） */
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

  const created = await prisma.$transaction(async (tx) => {
    const a = await tx.connectionAccount.create({
      data: {
        connectionId: connection.id,
        label,
        launchCommand: String(body.launchCommand ?? ""),
        notes: String(body.notes ?? ""),
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
  return NextResponse.json(created, { status: 201 });
}
