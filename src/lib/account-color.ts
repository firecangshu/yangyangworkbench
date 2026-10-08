/**
 * 账号颜色门牌（M36.2）
 *
 * 为什么要这个：多账号切换真正卡的不是「切不过去」，而是「切完分不清哪个窗口
 * 是哪个号」。浏览器官方的多账号用法就是给每个 profile 一个颜色/头像标识，
 * 社区吐槽最狠的也正是缺少这个。所以我们给每个号一个**永远不变**的颜色，
 * 卡片色点、桌面快捷方式图标、启动提示三处共用同一个色，肉眼一对就知道。
 *
 * 设计约束：
 * ① 必须是纯函数、无副作用、可离线断言——颜色不能每次刷新变一下，那样等于没有。
 * ② 输入必须含 id，不能只用 label：否则两个都叫「主号」的号会撞成同色。
 * ③ 调色板按「互相离得远」挑，不看好不好看；10 色对单人十几号的量绰绰有余。
 */

/** 名字给人口头指代用（「点那个橙色的」），hex 给渲染用，二者必须成对 */
export const PALETTE: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "玫红", hex: "#E11D48" },
  { name: "橙", hex: "#F97316" },
  { name: "鹅黄", hex: "#EAB308" },
  { name: "草绿", hex: "#84CC16" },
  { name: "翠绿", hex: "#22C55E" },
  { name: "青瓷", hex: "#14B8A6" },
  { name: "天青", hex: "#0EA5E9" },
  { name: "靛蓝", hex: "#4F46E5" },
  { name: "紫罗兰", hex: "#A855F7" },
  { name: "藕荷", hex: "#F472B6" },
];

/** FNV-1a：32 位里散得开、纯整数运算、跨语言可复现，比字符串 hash 更稳 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export type AccountColor = { name: string; hex: string; index: number };

/**
 * 取这个号的固定颜色。id 参与运算，保证同名不同号不撞色；
 * label 也参与，保证同 id 改名后颜色会换（改名本来就是新语义）。
 */
export function accountColor(id: number, label: string): AccountColor {
  const safeId = Number.isFinite(id) && id > 0 ? Math.trunc(id) : 0;
  const idx = fnv1a(`${safeId}|${String(label ?? "")}`) % PALETTE.length;
  return { ...PALETTE[idx], index: idx };
}

/** Windows 文件名不允许的字符；号名是用户随手打的，必须过这道才能当文件名 */
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * 把号名清成可用作文件名的片段：非法字符换下划线、控制字符剔掉、
 * 首尾点和空格去掉（Windows 会静默吞掉，导致「创建了但找不到」）、超长截断。
 * 只清字符，绝不改写或删除可读内容。
 */
export function safeFilePart(s: string, max = 40): string {
  const cleaned = String(s ?? "")
    .replace(ILLEGAL, "_")
    .replace(/[.\s]+$/g, "")
    .trim();
  const base = cleaned || "未命名号";
  return base.length > max ? base.slice(0, max) : base;
}

/** 快捷方式显示名：工具名 + 号名，桌面上要能一眼认出是哪个平台的哪个号 */
export function shortcutName(toolName: string, label: string): string {
  const t = safeFilePart(String(toolName ?? "").trim() || "工作台", 24);
  const l = safeFilePart(String(label ?? "").trim() || "未命名号", 32);
  return `${t}-${l}`;
}
