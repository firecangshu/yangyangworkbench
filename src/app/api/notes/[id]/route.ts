import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { noteJSON } from "@/lib/serializers";
import { normDate } from "@/lib/contest-playbook";

const VALID_KIND = ["note", "reminder"];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const nid = Number(id);
  const body = await req.json();
  const data: { date?: string; text?: string; kind?: string; done?: boolean; doneAt?: Date | null } = {};

  if (body.date !== undefined) {
    const d = normDate(String(body.date));
    if (!d) return NextResponse.json({ error: "date 必须为合法日期 yyyy-MM-dd" }, { status: 400 });
    data.date = d;
  }
  if (typeof body.text === "string" && body.text.trim()) data.text = body.text.trim();
  if (body.kind !== undefined) {
    if (!VALID_KIND.includes(String(body.kind))) return NextResponse.json({ error: "kind 只能为 note 或 reminder" }, { status: 400 });
    data.kind = String(body.kind);
  }
  if (typeof body.done === "boolean") {
    data.done = body.done;
    data.doneAt = body.done ? new Date() : null;
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ error: "无有效更新字段" }, { status: 400 });

  const note = await prisma.$transaction(async (tx) => {
    const before = await tx.calendarNote.findUnique({ where: { id: nid } });
    if (!before) return null;
    const updated = await tx.calendarNote.update({ where: { id: nid }, data });
    await logEvent(tx, "note", updated.id, "update", noteJSON(before), noteJSON(updated));
    return updated;
  });
  if (!note) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json(note);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const nid = Number(id);
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.calendarNote.findUnique({ where: { id: nid } });
    if (!before) return null;
    await tx.calendarNote.delete({ where: { id: nid } });
    await logEvent(tx, "note", before.id, "delete", noteJSON(before), null);
    return before;
  });
  if (!result) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
