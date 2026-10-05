import { NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import path from "path";

/**
 * E 盘编号目录体检（只读，永不删除）。
 * 检测：1) 同编号多目录  2) 名称疑似乱码  3) 修改时间分布
 */
export async function GET() {
  const root = "E:\\";
  const entries = await readdir(root, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());

  const numbered: { num: number; name: string; mtime: string }[] = [];
  for (const d of dirs) {
    const m = d.name.match(/^(\d+)\s*[.．、]/);
    if (!m) continue;
    let mtime = "";
    try {
      mtime = (await stat(path.join(root, d.name))).mtime.toISOString();
    } catch { /* ignore */ }
    numbered.push({ num: Number(m[1]), name: d.name, mtime });
  }
  numbered.sort((a, b) => a.num - b.num || (a.name < b.name ? -1 : 1));

  // 同编号分组
  const byNum = new Map<number, typeof numbered>();
  for (const item of numbered) {
    const arr = byNum.get(item.num) ?? [];
    arr.push(item);
    byNum.set(item.num, arr);
  }

  // 乱码启发：名称含 CJK 扩展区外的高频乱码特征（如 â æ å é 等 Latin-1 噪声混入中文目录）
  const garbled = numbered.filter((x) => /[ÃÂåæéèÃ]/.test(x.name) || /鈥|鏅|娴/.test(x.name));

  const duplicates = [...byNum.entries()]
    .filter(([, arr]) => arr.length > 1)
    .map(([num, arr]) => ({
      num,
      count: arr.length,
      dirs: arr.map((x) => ({ name: x.name, mtime: x.mtime.slice(0, 10) })),
    }));

  return NextResponse.json({
    scannedAt: new Date().toISOString(),
    root,
    numberedTotal: numbered.length,
    duplicateGroups: duplicates,
    garbledDirs: garbled.map((x) => ({ name: x.name, num: x.num, mtime: x.mtime.slice(0, 10) })),
    note: "本报告只读，不删除任何目录。清理需人工确认后另行操作。",
    allNumbered: numbered.map((x) => ({ num: x.num, name: x.name, mtime: x.mtime.slice(0, 10) })),
  });
}
