import { NextResponse } from "next/server";
import { existsSync, mkdirSync, rmSync } from "fs";
import { prisma } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { buildAccountLaunch, detectLoginMode, extractProfileDir, isUnderRoot, profileRoot, type LoginMode } from "@/lib/launch-profile";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  }
  const body = await req.json();
  const data: Record<string, string> = {};
  if (typeof body.label === "string" && body.label.trim()) data.label = body.label.trim();
  if (typeof body.launchCommand === "string") data.launchCommand = body.launchCommand;
  if (typeof body.notes === "string") data.notes = body.notes;

  /* M36：卡片换了程序路径或入口网址后，可以重新生成这个号的启动命令，不用手打
   * M36.3：重建默认沿用这个号原本的登录态来源（复用就是复用、隔离就是隔离），
   * 否则你一点 ↻ 就把一个登好的号踢成空的，那比不重建还坑。 */
  let profileDir = "";
  let mode: LoginMode = "reuse";
  if (body.regen === true) {
    const acc = await prisma.connectionAccount.findUnique({ where: { id: Number(id) } });
    if (!acc) return NextResponse.json({ error: "未找到" }, { status: 404 });
    const conn = await prisma.connection.findUnique({ where: { id: acc.connectionId } });
    if (!conn) return NextResponse.json({ error: "未找到该号所属卡片" }, { status: 404 });
    const siblings = await prisma.connectionAccount.findMany({
      where: { connectionId: conn.id, id: { not: acc.id } },
      select: { label: true },
    });
    const wantMode: LoginMode =
      body.mode === "reuse" || body.mode === "isolated" ? body.mode : detectLoginMode(acc.launchCommand);
    const built = buildAccountLaunch({
      card: { toolName: conn.toolName, launchCommand: conn.launchCommand, entryUrl: conn.entryUrl },
      label: data.label ?? acc.label,
      existingLabels: siblings.map((s) => s.label),
      mode: wantMode,
    });
    if (!built.ok) return NextResponse.json({ error: built.reason }, { status: 400 });
    data.launchCommand = built.cmd;
    profileDir = built.profileDir;
    mode = built.mode;
    try {
      if (profileDir) mkdirSync(profileDir, { recursive: true });
    } catch {
      /* 目录建不出来不阻塞保存，启动时浏览器会自己建 */
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "无有效更新字段" }, { status: 400 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const before = await tx.connectionAccount.findUnique({ where: { id: Number(id) } });
    if (!before) return null;
    const a = await tx.connectionAccount.update({ where: { id: Number(id) }, data });
    await logEvent(tx, "connection_account", a.id, "update",
      { label: before.label, launchCommand: before.launchCommand, notes: before.notes },
      { label: a.label, launchCommand: a.launchCommand, notes: a.notes });
    return a;
  });
  if (!updated) return NextResponse.json({ error: "未找到" }, { status: 404 });
  return NextResponse.json({ ...updated, profileDir, mode });
}

/*
 * DELETE /api/accounts/:id          —— 只删这条号
 * DELETE /api/accounts/:id?purge=1  —— 连它的独立登录空间目录一起清掉（M36.1）
 *
 * 为什么默认不清、清了要护栏：这个目录里是浏览器/程序自己存的登录态，
 * 留着占盘、删掉则要重新登录，所以交给用户选。而删除动作只允许发生在我们
 * 自己分出去的目录（isUnderRoot），并且不许删根目录本身——否则一条脏命令
 * 就能把「清理号目录」变成「删掉用户盘上任意目录」。
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  }
  const purge = new URL(req.url).searchParams.get("purge") === "1";
  const account = await prisma.connectionAccount.findUnique({ where: { id: Number(id) } });
  if (!account) return NextResponse.json({ error: "未找到" }, { status: 404 });

  let purged: string | null = null;
  let purgeSkipped = "";
  if (purge) {
    const dir = extractProfileDir(account.launchCommand);
    const root = profileRoot();
    if (!dir) purgeSkipped = "这个号用的是本机现成登录态，没分过独立目录，没东西可清";
    else if (!isUnderRoot(dir, root) || dir.replace(/[\\/]+$/, "").toLowerCase() === root.toLowerCase())
      purgeSkipped = "这个号的目录不在工作台登录空间根下，为防误删没有动它";
    else if (!existsSync(dir)) purgeSkipped = "目录本来就不存在";
    else {
      try {
        rmSync(dir, { recursive: true, force: true });
        purged = dir;
      } catch (e) {
        // 目录被正在开着的窗口占用是常态：如实说明，让号先手动关掉再清
        purgeSkipped = `目录被占用或没权限，号已删但目录留在 ${dir}，关掉该号窗口后可以再清一次`;
        void e;
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.connectionAccount.delete({ where: { id: Number(id) } });
    await logEvent(tx, "connection_account", Number(id), "delete",
      { connectionId: account.connectionId, label: account.label, launchCommand: account.launchCommand },
      { purged });
  });
  return NextResponse.json({ ok: true, purged, purgeSkipped });
}
