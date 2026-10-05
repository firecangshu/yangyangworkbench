import { readFileSync } from "fs";
const st = JSON.parse(readFileSync("E:/3.赛博聚宝盆/asset-registry/data/state.json", "utf-8"));
for (const [id, a] of Object.entries(st.assets ?? {})) {
  if (a.overlay?.starred) {
    console.log(`ID: ${id}`);
    console.log(`  path: ${a.lastKnownPath}`);
    console.log(`  hidden: ${a.overlay.hidden} remark: ${a.overlay.remark}`);
  }
}
