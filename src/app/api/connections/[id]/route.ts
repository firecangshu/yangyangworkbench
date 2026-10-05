import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { connectionJSON } from "@/lib/serializers";

const VALID_STATUS = ["active", "inactive", "pending"];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const data: Record<string, string | Date> = {};
  if (typeof body.toolName === "string" && body.toolName.trim()) data.toolName = body.toolName.trim();
  if (typeof body.category === "string") data.category = body.category;
  if (typeof body.entryUrl === "string") data.entryUrl = body.entryUrl;
  if (typeof body.accountNotes === "string") data.accountNotes = body.accountNotes;
  if (typeof body.credentialRef === "string") data.credentialRef = body.credentialRef;
  if (typeof body.launchCommand === "string") data.launchCommand = body.launchCommand;
  if (body.status && VALID_STATUS.includes(body.status)) data.status = body.status;
  if (typeof body.tags === "string") data.tags = body.tags;
  if (typeof body.notes === "string") data.notes = body.notes;
  if (body.touch) data.lastUsedAt = new Date();

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无有效更新字段" }, { status: 400 });
  }

  const connection = await prisma.$transaction(async (tx) => {
    const before = await tx.connection.findUnique({ where: { id: Number(id) } });
    if (!before) return null;
    const updated = await tx.connection.update({ where: { id: Number(id) }, data });
    await logEvent(tx, "connection", updated.id, "update", connectionJSON(before), connectionJSON(updated));
    return updated;
  });
  if (!connection) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json(connection);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.connection.findUnique({ where: { id: Number(id) } });
    if (!before) return null;
    await tx.connection.delete({ where: { id: Number(id) } });
    await logEvent(tx, "connection", before.id, "delete", connectionJSON(before), null);
    return before;
  });
  if (!result) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
