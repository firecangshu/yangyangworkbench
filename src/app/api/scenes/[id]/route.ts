import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { parseItems } from "@/lib/serializers";

/** 场景编辑（M17）：PATCH 改名称/备注/成员（items 全量替换），DELETE 只删台账不动程序 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  const sceneId = Number(id);
  const existing = await prisma.launchScene.findUnique({
    where: { id: sceneId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!existing) return NextResponse.json({ error: "未找到" }, { status: 404 });

  const body = await req.json();
  const name = body.name !== undefined ? String(body.name).trim() : existing.name;
  if (!name) return NextResponse.json({ error: "场景名称不能为空" }, { status: 400 });
  let items: { kind: string; refId: number }[] | null = null;
  if (body.items !== undefined) {
    const parsed = parseItems(body.items);
    if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
    items = parsed;
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (items) {
      await tx.launchSceneItem.deleteMany({ where: { sceneId } });
    }
    const s = await tx.launchScene.update({
      where: { id: sceneId },
      data: {
        name,
        ...(body.notes !== undefined ? { notes: String(body.notes) } : {}),
        ...(items ? { items: { create: items.map((it, i) => ({ ...it, sortOrder: i })) } } : {}),
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    await logEvent(tx, "launch_scene", sceneId, "update",
      { name: existing.name, items: existing.items.map((x) => `${x.kind}#${x.refId}`) },
      { name: s.name, items: s.items.map((x) => `${x.kind}#${x.refId}`) });
    return s;
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  const sceneId = Number(id);
  const existing = await prisma.launchScene.findUnique({
    where: { id: sceneId },
    include: { items: true },
  });
  if (!existing) return NextResponse.json({ error: "未找到" }, { status: 404 });

  await prisma.$transaction(async (tx) => {
    await tx.launchScene.delete({ where: { id: sceneId } });
    await logEvent(tx, "launch_scene", sceneId, "delete",
      { name: existing.name, items: existing.items.map((x) => `${x.kind}#${x.refId}`) }, null);
  });
  return NextResponse.json({ ok: true });
}
