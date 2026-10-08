import { NextResponse } from "next/server";
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { prisma } from "@/lib/db";
import { extractProfileDir } from "@/lib/launch-profile";

/*
 * 切号自检（M36.1）：GET /api/accounts/:id/probe
 *
 * 要补的洞是「假成功切号」：VS Code 系认 --user-data-dir，但自管凭据的桌面应用
 * （token 存在自家数据目录或系统凭据库里）会直接忽略这个参数——号名换了、目录换了，
 * 点进去还是同一个账号，而且界面上一切正常。这种看起来成功的 bug 比报错危险。
 *
 * 判据只用磁盘事实：这个号的登录空间目录在本次启动后有没有被写过。
 * 目录条目为空 = 程序压根没往里写（存疑）；最近 5 分钟内有条目被改 = 它真的用了这个目录。
 * 纯读操作，不写操作日志（前端会自动轮询，写日志会污染流水）。
 */

/** 认为「刚刚被写过」的时间窗 */
const FRESH_MS = 5 * 60 * 1000;
/** 下钻一层时每个子目录最多看多少个条目，防止大目录拖慢响应 */
const SCAN_LIMIT = 80;

function scan(dir: string): { entries: number; newestMs: number } {
  let entries = 0;
  let newestMs = 0;
  const bump = (t: number) => { if (t > newestMs) newestMs = t; };
  try {
    for (const name of readdirSync(dir)) {
      entries++;
      const p = join(dir, name);
      let st;
      try { st = statSync(p); } catch { continue; }
      bump(st.mtimeMs);
      // 登录态通常写在子目录深处（Default/Network/Cookies），顶层 mtime 不一定变，所以再下钻一层
      if (st.isDirectory()) {
        try {
          for (const child of readdirSync(p).slice(0, SCAN_LIMIT)) {
            try { bump(statSync(join(p, child)).mtimeMs); } catch { /* 占用中的文件读不到就算了 */ }
          }
        } catch { /* 无权限的子目录跳过 */ }
      }
    }
  } catch { /* 读不动就按空目录处理，让上层如实说明 */ }
  return { entries, newestMs };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: "id 必须为数字" }, { status: 400 });
  }
  const account = await prisma.connectionAccount.findUnique({ where: { id: Number(id) } });
  if (!account) return NextResponse.json({ error: "未找到" }, { status: 404 });

  const dir = extractProfileDir(account.launchCommand);
  if (!dir) {
    return NextResponse.json({
      verifiable: false,
      state: "none",
      reason: "这个号的命令里没有独立登录空间，用的就是本机现成登录态（或是手写命令），自检没有对象",
    });
  }
  if (!existsSync(dir)) {
    return NextResponse.json({ verifiable: true, state: "missing", dir, entries: 0 });
  }

  const { entries, newestMs } = scan(dir);
  const newestAt = newestMs ? new Date(newestMs).toISOString() : null;
  if (entries === 0) {
    return NextResponse.json({ verifiable: true, state: "empty", dir, entries: 0, newestAt });
  }
  const fresh = Date.now() - newestMs <= FRESH_MS;
  return NextResponse.json({
    verifiable: true,
    state: fresh ? "written" : "stale",
    dir,
    entries,
    newestAt,
  });
}
