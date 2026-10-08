/**
 * 桌面快捷方式的执行体（M36.2）
 *
 * .lnk 指向：node.exe <本脚本绝对路径> <accountId>
 * 它唯一的职责是向正在运行的工作台发一次 POST /api/accounts/:id/launch，
 * 也就是「替你在卡片上按一下 ▶」。
 *
 * 为什么不让快捷方式直接指向程序 exe：
 * 那样就绕过了启动队列与 EventLog，会出现「桌面上凭空多了个号窗口、日志里却查不到
 * 是谁启动的」这种审计空洞。走 API 则校验、队列、日志一样不缺。
 * 代价是快捷方式要求工作台在运行——连不上时我们不静默失败，而是弹窗说明。
 */
import { execFile } from "node:child_process";

const raw = String(process.argv[2] ?? "").trim().replace(/^a/, "");
if (!/^\d+$/.test(raw)) process.exit(2);

/**
 * 双击快捷方式却什么都没发生，是最让人困惑的失败。
 * 所以连不上就弹个窗。文案一律经环境变量递进去，一个字都不进命令文本
 * （PowerShell 的 -Command 后面直接追参数会被当成脚本文本解析，报 ParserError）。
 */
function notify(text) {
  const script =
    "Add-Type -AssemblyName System.Windows.Forms | Out-Null; " +
    "[Windows.Forms.MessageBox]::Show($env:WB_MSG, '杨杨的工作台', " +
    "[Windows.Forms.MessageBoxButtons]::OK, [Windows.Forms.MessageBoxIcon]::Warning) | Out-Null";
  execFile(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
    { windowsHide: true, timeout: 60000, env: { ...process.env, WB_MSG: text } },
    () => {}
  );
}

const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 10000);

try {
  const res = await fetch(`http://127.0.0.1:3000/api/accounts/${raw}/launch`, {
    method: "POST",
    signal: ctrl.signal,
  });
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 160);
    notify(`这个号没能启动，工作台回了 ${res.status}：${body || "（无详细说明）"}\n\n可以在连接中心里点开这个号看具体原因。`);
  }
} catch {
  notify(
    "工作台现在没在运行，所以这个号起不来。\n\n" +
      "先用桌面上的「杨杨的工作台」图标（或项目里的 launcher.bat）把工作台打开，" +
      "再双击这个号的快捷方式。"
  );
} finally {
  clearTimeout(timer);
}
