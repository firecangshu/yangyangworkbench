import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["mcp/server.mjs"],
    cwd: process.cwd(),
  });
  const client = new Client({ name: "workbench-test", version: "1.0.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  const toolNames = tools.tools.map((t) => t.name);
  console.log("TOOLS:", toolNames.join(", "));
  // 不比魔数：只断言必需工具齐备（新增工具不该把冒烟测试变红）
  const REQUIRED = [
    "list_projects",
    "get_project",
    "list_contests",
    "add_event",
    "build_roadshow_input",
    "sync_projects",
  ];
  const missing = REQUIRED.filter((n) => !toolNames.includes(n));
  if (missing.length) throw new Error(`MCP 缺少工具: ${missing.join(", ")}`);

  const projects = await client.callTool({ name: "list_projects", arguments: {} });
  const pText = projects.content[0].text;
  const pData = JSON.parse(pText);
  console.log("list_projects count =", pData.count);
  if (pData.count < 8) throw new Error("项目数应>=8");

  const contests = await client.callTool({ name: "list_contests", arguments: {} });
  const cText = contests.content[0].text;
  const cData = JSON.parse(cText);
  console.log("list_contests count =", cData.count);
  const gosim = cData.contests.find((c) => c.name.includes("GOSIM"));
  console.log("GOSIM deliverables =", gosim.deliverables.length, "done =", gosim.doneCount, "links =", gosim.links.map((l) => l.name).join("|"));

  const one = await client.callTool({ name: "get_project", arguments: { id: 1 } });
  const oneData = JSON.parse(one.content[0].text);
  console.log("get_project(1) =", oneData.name);

  const ev = await client.callTool({
    name: "add_event",
    arguments: { entityType: "note", entityId: 0, action: "mcp_smoke", note: "MCP 协议联调测试" },
  });
  const evData = JSON.parse(ev.content[0].text);
  console.log("add_event =", evData.ok, evData.action);

  // M30 build_roadshow_input：显式 stage 与缺省推断两条路径都验证
  const pkt = await client.callTool({ name: "build_roadshow_input", arguments: { contestId: gosim.id, stage: "prepare" } });
  const pktText = pkt.content[0].text;
  if (!pktText.includes("路演输入包") || !pktText.includes("结果日") || !pktText.includes("PPT"))
    throw new Error("build_roadshow_input(prepare) packet 校验失败");
  console.log("build_roadshow_input(prepare) 产物含 PPT/预测问答 =", pktText.includes("PPT") && pktText.includes("预测问答"));
  const pktAuto = await client.callTool({ name: "build_roadshow_input", arguments: { contestId: gosim.id } });
  console.log("build_roadshow_input(缺省推断) 含当前阶段行 =", pktAuto.content[0].text.includes("当前阶段："));

  await client.close();
  console.log("MCP_SMOKE_PASS");
}
main().catch((e) => {
  console.error("MCP_SMOKE_FAIL", e);
  process.exit(1);
});
