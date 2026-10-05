import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent, projectJSON } from "@/lib/events";
import { contestJSON } from "@/lib/serializers";

export async function GET() {
  const contests = await prisma.contest.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      deliverables: true,
      links: { include: { project: { select: { id: true, name: true, status: true, path: true } } } },
    },
  });
  return NextResponse.json(contests);
}

export async function POST(req: Request) {
  const body = await req.json();
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "比赛名称为必填项" }, { status: 400 });

  const contest = await prisma.$transaction(async (tx) => {
    const created = await tx.contest.create({
      data: {
        name,
        organizer: String(body.organizer ?? ""),
        track: String(body.track ?? ""),
        startDate: String(body.startDate ?? ""),
        deadline: String(body.deadline ?? ""),
        status: String(body.status ?? "research"),
        submitLink: String(body.submitLink ?? ""),
        notes: String(body.notes ?? ""),
      },
    });
    await logEvent(tx, "contest", created.id, "create", null, contestJSON(created));
    return created;
  });
  return NextResponse.json(contest, { status: 201 });
}
