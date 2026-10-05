// 首页卡片布局配置（M27）：卡片的「尺寸 / 顺序 / 显隐」在设置页里摆好，点确定后固定下来。
// 权威源=本机浏览器 localStorage（与主题 queetai-theme 同一处），不入库、不碰业务数据（红线①③⑤）。
export type BlockId =
  | "hero" // 问候 + 时钟 + 内嵌月历（今日枢纽）
  | "scenes" // 我的启动场景
  | "kpi" // KPI 芯片行
  | "contests" // 赛事总览（列表 ↔ 甘特）
  | "programs" // 常用程序 Top6
  | "events" // 最近动态
  | "projects"; // 项目进展

/** 卡片占 12 列栅格里的几列：full=整行，twoThirds=2/3，half=半行，third=1/3 */
export type BlockSize = "full" | "twoThirds" | "half" | "third";

export type BlockCfg = { id: BlockId; size: BlockSize; visible: boolean };

export const BLOCK_LABELS: Record<BlockId, string> = {
  hero: "今日枢纽（问候 · 时钟 · 月历）",
  scenes: "我的启动场景",
  kpi: "KPI 芯片行",
  contests: "赛事总览（列表 / 甘特）",
  programs: "常用程序 Top6",
  events: "最近动态",
  projects: "项目进展",
};

export const SIZE_LABELS: Record<BlockSize, string> = {
  full: "整行",
  twoThirds: "2/3 行",
  half: "半行",
  third: "1/3 行",
};

// Tailwind 需要静态类名字面量才能被扫描到，所以这里逐档写出完整字符串，不做拼接。
export const SPAN_CLASS: Record<BlockSize, string> = {
  full: "lg:col-span-12",
  twoThirds: "lg:col-span-8",
  half: "lg:col-span-6",
  third: "lg:col-span-4",
};

export const DEFAULT_LAYOUT: BlockCfg[] = [
  { id: "hero", size: "full", visible: true },
  { id: "scenes", size: "full", visible: true },
  { id: "kpi", size: "full", visible: true },
  { id: "contests", size: "full", visible: true },
  { id: "programs", size: "half", visible: true },
  { id: "events", size: "half", visible: true },
  { id: "projects", size: "full", visible: true },
];

const KEY = "queetai-dashboard-layout";

/** 布局变更事件：设置页点确定后派发，已打开的首页即时重排（同一浏览器标签内） */
export const LAYOUT_EVENT = "queetai-dashboard-layout";

/**
 * 读取本机布局配置。
 * 与默认表按 id 合并：新增卡片自动补在末尾、已删除卡片的残留配置自动丢弃，顺序沿用保存的那份。
 */
export function loadLayout(): BlockCfg[] {
  if (typeof window === "undefined") return DEFAULT_LAYOUT.map((x) => ({ ...x }));
  let saved: unknown;
  try {
    saved = JSON.parse(window.localStorage.getItem(KEY) || "null");
  } catch {
    saved = null;
  }
  if (!Array.isArray(saved)) return DEFAULT_LAYOUT.map((x) => ({ ...x }));
  const byId = new Map<BlockId, BlockCfg>();
  for (const raw of saved) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Partial<BlockCfg>;
    if (!r.id || !(r.id in BLOCK_LABELS)) continue;
    byId.set(r.id, {
      id: r.id,
      size: r.size === "twoThirds" || r.size === "half" || r.size === "third" || r.size === "full" ? r.size : "full",
      visible: r.visible !== false,
    });
  }
  const out: BlockCfg[] = [];
  for (const cfg of byId.values()) out.push(cfg);
  for (const d of DEFAULT_LAYOUT) if (!byId.has(d.id)) out.push({ ...d });
  return out;
}

export function saveLayout(cfg: BlockCfg[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cfg));
    window.dispatchEvent(new Event(LAYOUT_EVENT));
  } catch {
    // 隐私模式等场景写不进去：不阻断页面，只是布局回落到默认
  }
}
