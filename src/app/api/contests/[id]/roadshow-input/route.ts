import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { appendFile, mkdir } from "fs/promises";
import { join } from "path";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { phaseOf } from "@/lib/contest-playbook";
import { buildContestInputPacket } from "@/lib/roadshow-input";

/**
 * POST /api/contests/:id/roadshow-input
 * body: { launch?: boolean }
 * 返回 { packet, phase }；launch=true 时 spawn 魔术师连接卡的启动器（安全范式同 connections/launch）。
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  const contestId = Number(id);

  const contest = await prisma.contest.findUnique({
    where: { id: contestId },
    include: { links: { include: { project: true } } },
  });
  if (!contest) return NextResponse.json({ error: "未找到比赛" }, { status: 404 });

  const phase = phaseOf(contest.status);
  const projects = contest.links.map((l) => ({
    name: l.project.name, path: l.project.path,
    summary: l.project.summary, tags: l.project.tags, lastNote: l.project.lastNote,
  }));

  const packet = buildContestInputPacket(
    { name: contest.name, organizer: contest.organizer, track: contest.track,
      startDate: contest.startDate, deadline: contest.deadline,
      status: contest.status, notes: contest.notes, resultDate: contest.resultDate },
    projects, phase,
  );

  // 可选调起 Studio（复用安全 spawn 链路：写队列 → 固定启动器 execFile）
  const body = await req.json().catch(() => ({}));
  if (body.launch) {
    const magician = await prisma.connection.findFirst({ where: { toolName: "黑客松路演魔术师" } });
    if (magician?.launchCommand.trim()) {
      try {
        await mkdir("scripts", { recursive: true });
        await appendFile(join("scripts", ".launch-queue"), `${magician.id}\n`, "utf-8");
        const child = spawn("node", ["scripts/launch-connection.mjs"], {
          shell: false, detached: true, stdio: "ignore", windowsHide: true,
        });
        child.unref();
        child.on("error", () => {});
      } catch { /* 调起失败不阻塞 packet 返回 */ }
    }
  }

  await prisma.$transaction(async (tx) => {
    await logEvent(tx, "contest", contestId, "roadshow_input", null, { phase, launched: !!body.launch });
  });

  return NextResponse.json({ packet, phase });
}
