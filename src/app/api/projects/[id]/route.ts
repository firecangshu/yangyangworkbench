import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent, projectJSON } from "@/lib/events";

const VALID_CATEGORIES = ["skill", "product", "contest", "patent", "other"];
const VALID_STATUS = ["incubating", "dev", "submitted", "maintain", "done"];

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id: Number(id) } });
  if (!project) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json(project);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();

  const data: Record<string, string> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.path === "string" && body.path.trim()) data.path = body.path.trim();
  if (body.category && VALID_CATEGORIES.includes(body.category)) data.category = body.category;
  if (body.status && VALID_STATUS.includes(body.status)) data.status = body.status;
  if (typeof body.summary === "string") data.summary = body.summary;
  if (typeof body.tags === "string") data.tags = body.tags;
  if (typeof body.lastNote === "string") data.lastNote = body.lastNote;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无有效更新字段" }, { status: 400 });
  }

  const project = await prisma.$transaction(async (tx) => {
    const before = await tx.project.findUnique({ where: { id: Number(id) } });
    if (!before) return null;
    const updated = await tx.project.update({ where: { id: Number(id) }, data });
    await logEvent(tx, "project", updated.id, "update", projectJSON(before), projectJSON(updated));
    return updated;
  });

  if (!project) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json(project);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.project.findUnique({ where: { id: Number(id) } });
    if (!before) return null;
    await tx.project.delete({ where: { id: Number(id) } });
    await logEvent(tx, "project", before.id, "delete", projectJSON(before), null);
    return before;
  });
  if (!result) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
