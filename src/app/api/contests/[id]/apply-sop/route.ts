import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";

/**
 * 套用 SOP 模板（M10）：POST /api/contests/:id/apply-sop  body: { sopId }
 * 按模板步骤为比赛生成交付物清单，同名跳过（不重复生成）。
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  const contestId = Number(id);
  const body = await req.json();
  const sopId = Number(body.sopId);
  if (!Number.isInteger(sopId) || sopId <= 0) {
    return NextResponse.json({ error: "sopId 必填" }, { status: 400 });
  }

  const sop = await prisma.sopTemplate.findUnique({
    where: { id: sopId },
    include: { steps: { orderBy: { sortOrder: "asc" } } },
  });
  if (!sop) return NextResponse.json({ error: "SOP 模板未找到" }, { status: 404 });
  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  if (!contest) return NextResponse.json({ error: "比赛未找到" }, { status: 404 });

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.deliverable.findMany({ where: { contestId }, select: { name: true } });
    const existingNames = new Set(existing.map((d) => d.name));
    const createdNames: string[] = [];
    for (const step of sop.steps) {
      if (existingNames.has(step.name)) continue;
      const d = await tx.deliverable.create({ data: { contestId, name: step.name } });
      await logEvent(tx, "deliverable", d.id, "create", null, {
        contestId, name: step.name, done: false, viaSop: sop.id,
      });
      createdNames.push(step.name);
    }
    await logEvent(tx, "contest", contestId, "apply_sop", null, {
      sopId: sop.id, sopName: sop.name,
      created: createdNames.length, skipped: sop.steps.length - createdNames.length,
    });
    return { created: createdNames, skipped: sop.steps.length - createdNames.length };
  });

  return NextResponse.json({
    ok: true,
    sopName: sop.name,
    contestName: contest.name,
    created: result.created,
    skipped: result.skipped,
  });
}
