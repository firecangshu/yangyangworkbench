import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { parseItems } from "@/lib/serializers";

/**
 * 启动场景（M17）：把常用程序+指定账号存成组合，一键并行拉起。
 * items 结构：[{ kind: "connection" | "account", refId: number }]，按数组顺序即 sortOrder。
 */
export async function GET() {
  const scenes = await prisma.launchScene.findMany({
    orderBy: { id: "asc" },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  return NextResponse.json(scenes);
}

export async function POST(req: Request) {
  const body = await req.json();
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "场景名称为必填项" }, { status: 400 });
  const items = parseItems(body.items);
  if (typeof items === "string") return NextResponse.json({ error: items }, { status: 400 });

  const created = await prisma.$transaction(async (tx) => {
    const s = await tx.launchScene.create({
      data: {
        name,
        notes: String(body.notes ?? ""),
        items: { create: items.map((it, i) => ({ ...it, sortOrder: i })) },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    });
    await logEvent(tx, "launch_scene", s.id, "create", null, {
      name,
      notes: s.notes,
      items: items.map((it) => `${it.kind}#${it.refId}`),
    });
    return s;
  });
  return NextResponse.json(created, { status: 201 });
}
