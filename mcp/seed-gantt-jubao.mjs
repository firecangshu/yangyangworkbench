const updates = [
  { key: "GOSIM", startDate: "2026-09-13" },
  { key: "AI杭州", startDate: "2026-09-01" },
  { key: "Anker", startDate: "2026-09-07" },
  { key: "涌现�?, startDate: "2026-09-10" },
  { key: "ModelScope", startDate: "2026-07-07" },
];

async function main() {
  const contests = await (await fetch("http://localhost:3000/api/contests")).json();
  for (const u of updates) {
    const c = contests.find((x) => x.name.includes(u.key));
    if (!c) { console.log("SKIP", u.key); continue; }
    const r = await fetch(`http://localhost:3000/api/contests/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate: u.startDate }),
    });
    console.log(`OK ${u.key} start=${u.startDate} (${r.status})`);
  }

  const conns = await (await fetch("http://localhost:3000/api/connections")).json();
  if (!conns.find((c) => c.toolName.includes("聚宝�?))) {
    const r = await fetch("http://localhost:3000/api/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolName: "赛博聚宝�?,
        category: "other",
        entryUrl: "",
        accountNotes: "本地资产注册系统：扫描登�?skill/程序资产，支持多平台探测与发布推送（git/multipart/json�?,
        credentialRef: "E:\\3.赛博聚宝盆\\asset-registry\\config.json（auth 字段�?,
        tags: "资产,发布,推�?聚宝�?,
        notes: "工作台可通过设置页「资产导入」只读其 state.json�?89 条资产注册表。三条产品线：PC独立�?桌面exe/WorkBuddy skill",
      }),
    });
    console.log("聚宝盆卡片已登记:", r.status);
  } else {
    console.log("聚宝盆卡片已存在");
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
