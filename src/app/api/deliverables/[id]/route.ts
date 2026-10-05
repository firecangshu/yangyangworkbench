import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";

const snap = (d: { id: number; contestId: number; name: string; done: boolean; doneAt: Date | null }) => ({
  id: d.id, contestId: d.contestId, name: d.name, done: d.done, doneAt: d.doneAt,
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  return prisma.$transaction(async (tx) => {
    const before = await tx.deliverable.findUnique({ where: { id: Number(id) } });
    if (!before) return NextResponse.json({ error: "未找到" }, { status: 404 });

    const data: { name?: string; done?: boolean; doneAt?: Date | null } = {};
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
    if (typeof body.done === "boolean") {
      data.done = body.done;
      data.doneAt = body.done ? new Date() : null;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "无有效更新字段" }, { status: 400 });
    }

    const updated = await tx.deliverable.update({ where: { id: Number(id) }, data });
    await logEvent(tx, "deliverable", updated.id, "update", snap(before), snap(updated));
    return NextResponse.json(updated);
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return prisma.$transaction(async (tx) => {
    const before = await tx.deliverable.findUnique({ where: { id: Number(id) } });
    if (!before) return NextResponse.json({ error: "未找到" }, { status: 404 });
    await tx.deliverable.delete({ where: { id: Number(id) } });
    await logEvent(tx, "deliverable", before.id, "delete", snap(before), null);
    return NextResponse.json({ ok: true });
  });
}
