import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  }
  const body = await req.json();
  const data: Record<string, string> = {};
  if (typeof body.label === "string" && body.label.trim()) data.label = body.label.trim();
  if (typeof body.launchCommand === "string") data.launchCommand = body.launchCommand;
  if (typeof body.notes === "string") data.notes = body.notes;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无有效更新字段" }, { status: 400 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.connectionAccount.findUnique({ where: { id: Number(id) } });
    if (!before) return null;
    const a = await tx.connectionAccount.update({ where: { id: Number(id) }, data });
    await logEvent(tx, "connection_account", a.id, "update",
      { label: before.label, launchCommand: before.launchCommand, notes: before.notes },
      { label: a.label, launchCommand: a.launchCommand, notes: a.notes });
    return a;
  });
  if (!updated) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  }
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.connectionAccount.findUnique({ where: { id: Number(id) } });
    if (!before) return null;
    await tx.connectionAccount.delete({ where: { id: Number(id) } });
    await logEvent(tx, "connection_account", before.id, "delete",
      { connectionId: before.connectionId, label: before.label, launchCommand: before.launchCommand }, null);
    return before;
  });
  if (!result) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
