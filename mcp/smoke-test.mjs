import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["mcp/server.mjs"],
    cwd: process.cwd(),
  });
  const client = new Client({ name: "queetai-test", version: "1.0.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log("TOOLS:", tools.tools.map((t) => t.name).join(", "));
  if (tools.tools.length !== 4) throw new Error("工具数应为 4");

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

  await client.close();
  console.log("MCP_SMOKE_PASS");
}
main().catch((e) => {
  console.error("MCP_SMOKE_FAIL", e);
  process.exit(1);
});
