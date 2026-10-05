import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const contestId = Number(id);
  const body = await req.json();
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "交付物名称为必填项" }, { status: 400 });

  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest) return NextResponse.json({ error: "比赛未找到" }, { status: 404 });

  const deliverable = await prisma.$transaction(async (tx) => {
    const created = await tx.deliverable.create({ data: { contestId, name } });
    await logEvent(tx, "deliverable", created.id, "create", null, {
      contestId, name, done: false,
    });
    return created;
  });
  return NextResponse.json(deliverable, { status: 201 });
}
