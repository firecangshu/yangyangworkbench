import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  const body = await req.json();
  const data: Record<string, string> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.description === "string") data.description = body.description;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无有效更新字段" }, { status: 400 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.sopTemplate.findUnique({ where: { id: Number(id) } });
    if (!before) return null;
    const t = await tx.sopTemplate.update({ where: { id: Number(id) }, data });
    await logEvent(tx, "sop_template", t.id, "update",
      { name: before.name, description: before.description },
      { name: t.name, description: t.description });
    return t;
  });
  if (!updated) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.sopTemplate.findUnique({
      where: { id: Number(id) },
      include: { steps: { orderBy: { sortOrder: "asc" } } },
    });
    if (!before) return null;
    await tx.sopTemplate.delete({ where: { id: Number(id) } });
    await logEvent(tx, "sop_template", before.id, "delete",
      { name: before.name, steps: before.steps.map((s) => s.name) }, null);
    return before;
  });
  if (!result) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
