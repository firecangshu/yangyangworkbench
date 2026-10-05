const updates = [
  {
    key: "GOSIM",
    deadline: "2026-10-16",
    note: "【10-04 联网核实】大会 10-16~17 深圳南山伊敦酒店；Spotlight 中国区投递截止 10-04；Agentic App 报名 9-23 已过；智能体软件工厂赛道具体提交节点以官方群通知为准。来源：spotlight.gosim.org / opencamp.cn",
  },
  {
    key: "AI杭州",
    deadline: "2026-09-19",
    note: "【10-04 联网核实】「AI杭州·码动未来」官方作品提交截止 2026-09-19（多源确认，已过期）。实际是否已提交请自查。来源：aichallenge.msup.com.cn 相关报道",
  },
  {
    key: "Anker",
    deadline: "2026-09-27",
    note: "【10-04 联网核实】预赛材料截止 2026-09-27 23:59（已过）；9-30 公布出线名单；决赛 10-16~17 深圳 24H 集中开发。入围状态请自查。来源：career.anker.com.cn / 飞书选手中心",
  },
  {
    key: "涌现奖",
    deadline: "2026-11-10",
    note: "【10-04 联网核实】首轮作品投递截止 2026-11-10 23:59（未过期）；官网有第一赛季投递周期延长公告，新日期以官网为准。来源：abaoemerge.alipay.com / ModelScope 赛事页",
  },
  {
    key: "ModelScope",
    deadline: "2026-08-31",
    note: "【10-04 联网核实】英特尔×魔搭第三期征文截止 2026-08-31（已过）；9-23 苏州 Intel Connection 2026 总决赛已落幕，获奖名单已公布。来源：51openlab.com",
  },
];

async function main() {
  const res = await fetch("http://localhost:3000/api/contests");
  const contests = await res.json();
  for (const u of updates) {
    const c = contests.find((x) => x.name.includes(u.key));
    if (!c) { console.log("SKIP 未找到:", u.key); continue; }
    const notes = (c.notes ? c.notes + "\n" : "") + u.note;
    const r = await fetch(`http://localhost:3000/api/contests/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deadline: u.deadline, notes }),
    });
    const d = await r.json();
    console.log(`OK ${u.key} -> deadline=${d.deadline ?? r.status}`);
  }
  const after = await (await fetch("http://localhost:3000/api/contests")).json();
  console.log("\n=== 全部比赛截止日 ===");
  for (const c of after) {
    console.log(`  ${c.deadline || "待定"}  ${c.name}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
