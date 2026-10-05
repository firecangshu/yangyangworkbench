import { readFileSync } from "fs";
const st = JSON.parse(readFileSync("E:/3.赛博聚宝盆/asset-registry/data/state.json", "utf-8"));
const entries = Object.entries(st.assets ?? {});
let starred = 0, hidden = 0, hasPath = 0;
const kinds = {};
for (const [id, a] of entries) {
  const o = a.overlay ?? {};
  if (o.starred) starred++;
  if (o.hidden) hidden++;
  if (a.lastKnownPath) hasPath++;
  const k = id.split(":")[0];
  kinds[k] = (kinds[k] ?? 0) + 1;
}
console.log(`总数=${entries.length} 星标=${starred} 隐藏=${hidden} 有路径=${hasPath}`);
console.log("类型分布:", JSON.stringify(kinds));
