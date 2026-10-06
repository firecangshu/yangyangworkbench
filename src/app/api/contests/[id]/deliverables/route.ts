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

  // M30：助手直出登记时可一并带 stage（产物组）、path（"assistant-inline" 或引擎产物路径）、done
  const stage = typeof body.stage === "string" ? body.stage : "";
  const path = typeof body.path === "string" ? body.path : "";
  const done = body.done === true;

  const deliverable = await prisma.$transaction(async (tx) => {
    const created = await tx.deliverable.create({
      data: { contestId, name, stage, path, done, doneAt: done ? new Date() : null },
    });
    await logEvent(tx, "deliverable", created.id, "create", null, {
      contestId, name, stage, path, done,
    });
    return created;
  });
  return NextResponse.json(deliverable, { status: 201 });
}
