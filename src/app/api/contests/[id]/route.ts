import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent, projectJSON } from "@/lib/events";
import { contestJSON } from "../route";

const VALID_STATUS = ["research", "registered", "preparing", "submitted", "won", "lost", "cancelled", "expired"];

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const contest = await prisma.contest.findUnique({
    where: { id: Number(id) },
    include: {
      deliverables: { orderBy: { id: "asc" } },
      links: { include: { project: true } },
    },
  });
  if (!contest) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json(contest);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const data: Record<string, string> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.organizer === "string") data.organizer = body.organizer;
  if (typeof body.track === "string") data.track = body.track;
  if (typeof body.startDate === "string") data.startDate = body.startDate;
  if (typeof body.deadline === "string") data.deadline = body.deadline;
  if (body.status && VALID_STATUS.includes(body.status)) data.status = body.status;
  if (typeof body.submitLink === "string") data.submitLink = body.submitLink;
  if (typeof body.notes === "string") data.notes = body.notes;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无有效更新字段" }, { status: 400 });
  }

  const contest = await prisma.$transaction(async (tx) => {
    const before = await tx.contest.findUnique({ where: { id: Number(id) } });
    if (!before) return null;
    const updated = await tx.contest.update({ where: { id: Number(id) }, data });
    await logEvent(tx, "contest", updated.id, "update", contestJSON(before), contestJSON(updated));
    return updated;
  });
  if (!contest) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json(contest);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.contest.findUnique({ where: { id: Number(id) } });
    if (!before) return null;
    await tx.contest.delete({ where: { id: Number(id) } });
    await logEvent(tx, "contest", before.id, "delete", contestJSON(before), null);
    return before;
  });
  if (!result) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
