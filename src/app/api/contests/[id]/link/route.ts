import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";

/** POST = 关联项目；DELETE = 解除关联 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const contestId = Number(id);
  const body = await req.json();
  const projectId = Number(body.projectId);
  if (!projectId) return NextResponse.json({ error: "projectId 必填" }, { status: 400 });

  const contest = await prisma.contest.findUnique({ where: { id: contestId } });
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!contest || !project) return NextResponse.json({ error: "比赛或项目不存在" }, { status: 404 });

  const result = await prisma.$transaction(async (tx) => {
    const exists = await tx.contestProject.findUnique({
      where: { contestId_projectId: { contestId, projectId } },
    });
    if (exists) return { dup: true, link: exists };
    const link = await tx.contestProject.create({ data: { contestId, projectId } });
    await logEvent(tx, "contest_project", link.id, "create", null, {
      contestId, contestName: contest.name, projectId, projectName: project.name,
    });
    return { dup: false, link };
  });

  if (result.dup) return NextResponse.json({ error: "已关联" }, { status: 409 });
  return NextResponse.json(result.link, { status: 201 });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const contestId = Number(id);
  const body = await req.json();
  const projectId = Number(body.projectId);
  if (!projectId) return NextResponse.json({ error: "projectId 必填" }, { status: 400 });

  return prisma.$transaction(async (tx) => {
    const link = await tx.contestProject.findUnique({
      where: { contestId_projectId: { contestId, projectId } },
    });
    if (!link) return NextResponse.json({ error: "未关联" }, { status: 404 });
    await tx.contestProject.delete({ where: { id: link.id } });
    await logEvent(tx, "contest_project", link.id, "delete", { contestId, projectId }, null);
    return NextResponse.json({ ok: true });
  });
}
