// 首页卡片布局配置（M27 尺寸/顺序/显隐 + M28 卡内字号/卡片色/文字色）。
// 权威源=本机浏览器 localStorage（与主题 queetai-theme 同一处），不入库、不碰业务数据（红线①③⑤）。
export type BlockId =
  | "hero" // 问候 + 时钟 + 内嵌月历（今日枢纽）
  | "scenes" // 我的启动场景
  | "kpi" // KPI 芯片行
  | "contests" // 赛事总览（列表 ↔ 甘特）
  | "programs" // 常用程序 Top6
  | "events" // 最近动态
  | "projects"; // 项目进展

/** M29：卡片在 12 列栅格里占几列（1~12），由画板拖右缘吸附整列而来；取代旧四档 size */
export type BlockCfg = {
  id: BlockId;
  colSpan: number;
  visible: boolean;
  fs: FontScale;
  skin: SkinId;
  fg: FgChoice;
};

/** 卡内字号档（M28）：作用在整张卡上，仍与卡片宽度成比例，只是整体抬/压一档 */
export type FontScale = "sm" | "md" | "lg" | "xl";

/** 卡片配色皮肤（M28）：预设 8 色 + 跟随主题，深底皮肤自带反白，不会调出看不清的组合 */
export type SkinId =
  | "default"
  | "snow"
  | "cream"
  | "mist"
  | "sage"
  | "ink"
  | "navy"
  | "teal"
  | "terra";

/** 文字颜色档（M28）：默认跟随所选皮肤，可强行压深/提浅/走赤陶 */
export type FgChoice = "auto" | "dark" | "light" | "brand";

export const BLOCK_LABELS: Record<BlockId, string> = {
  hero: "今日枢纽（问候 · 时钟 · 月历）",
  scenes: "我的启动场景",
  kpi: "KPI 芯片行",
  contests: "赛事总览（列表 / 甘特）",
  programs: "常用程序 Top6",
  events: "最近动态",
  projects: "项目进展",
};

export const FONT_LABELS: Record<FontScale, string> = {
  sm: "紧凑",
  md: "标准",
  lg: "大字",
  xl: "超大",
};

/** 字号倍率：乘在 M26 的 cqi 比例式上，卡片宽度依然主导字号 */
export const FONT_MULT: Record<FontScale, number> = { sm: 0.92, md: 1, lg: 1.15, xl: 1.3 };

export const FG_LABELS: Record<FgChoice, string> = {
  auto: "跟随",
  dark: "深墨字",
  light: "浅白字",
  brand: "赤陶字",
};

/** 一套皮肤 = 一组确定值（背景 / 内层浅底 / 描边 / 主字 / 副字），深浅由 dark 标记 */
export type Skin = {
  label: string;
  bg: string;
  soft: string;
  line: string;
  fg: string;
  muted: string;
  dark: boolean;
};

export const SKINS: Record<SkinId, Skin> = {
  default: { label: "跟随主题", bg: "", soft: "", line: "", fg: "", muted: "", dark: false },
  snow: { label: "雪白", bg: "#ffffff", soft: "#f4f6f9", line: "#e5e9f0", fg: "#1f2937", muted: "#6b7688", dark: false },
  cream: { label: "米纸", bg: "#fbf6ea", soft: "#f2ead8", line: "#e7e0d0", fg: "#3a3220", muted: "#8a8071", dark: false },
  mist: { label: "淡青", bg: "#f1f6fb", soft: "#e4edf6", line: "#dce7f1", fg: "#1b3a55", muted: "#5c7c96", dark: false },
  sage: { label: "淡雀绿", bg: "#eef5ee", soft: "#e0ecdf", line: "#d5e6d4", fg: "#1f3b2a", muted: "#5e7a66", dark: false },
  ink: { label: "墨黑", bg: "#232a33", soft: "#2d3641", line: "#3a434f", fg: "#e8ecf2", muted: "#a3aebe", dark: true },
  navy: { label: "墨蓝", bg: "#2c3e50", soft: "#35495e", line: "#3e5568", fg: "#e2e8f0", muted: "#a9b7c6", dark: true },
  teal: { label: "青黑", bg: "#10333a", soft: "#17414a", line: "#244a52", fg: "#ddf2f4", muted: "#92bec4", dark: true },
  terra: { label: "赤陶浅底", bg: "#fbefee", soft: "#f5e0de", line: "#f2d9d7", fg: "#7a2b28", muted: "#a9645f", dark: false },
};

export const SKIN_ORDER: SkinId[] = ["default", "snow", "cream", "mist", "sage", "ink", "navy", "teal", "terra"];

/** 选完皮肤后真正落地的文字色（auto 用皮肤自带值，深浅底下的赤陶取不同亮度保对比） */
export function resolveFg(cfg: { skin: SkinId; fg: FgChoice }): string {
  const s = SKINS[cfg.skin];
  if (cfg.fg === "dark") return "#1f2937";
  if (cfg.fg === "light") return "#f2f5f9";
  if (cfg.fg === "brand") return s.dark ? "#ff9a8c" : "#c9463f";
  return s.fg;
}

/** 需要覆写配色吗（皮肤=跟随 且 文字=跟随 时整块原样交给主题） */
export function hasColorOverride(cfg: { skin: SkinId; fg: FgChoice }): boolean {
  return cfg.skin !== "default" || cfg.fg !== "auto";
}

/** 皮肤深浅档：供 CSS 判断要不要把日历语义色（节日金/节气青/赛事赤陶）提亮 */
export function skinTone(skin: SkinId): "dark" | "light" | null {
  if (skin === "default") return null;
  return SKINS[skin].dark ? "dark" : "light";
}

/**
 * 把一张卡的配色/字号配置折算成 CSS 变量。
 * 首页 Block 与设置页预览共用这一份算法，保证「预览所见 = 首页所得」。
 */
export function cardVars(cfg: { skin: SkinId; fg: FgChoice; fs: FontScale }): Record<string, string> {
  const v: Record<string, string> = { "--card-fs": String(FONT_MULT[cfg.fs]) };
  if (cfg.skin !== "default") {
    const s = SKINS[cfg.skin];
    v["--skin-bg"] = s.bg;
    v["--skin-soft"] = s.soft;
    v["--skin-line"] = s.line;
    v["--skin-muted"] = s.muted;
  }
  if (hasColorOverride(cfg)) v["--skin-fg"] = resolveFg(cfg);
  return v;
}

// 旧首页消费点：按 colSpan（1~12）取静态类名，Tailwind 需要字面量才能被扫描到，逐档写出。
export const COL_SPAN_CLASS: Record<number, string> = {
  1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4",
  5: "lg:col-span-5", 6: "lg:col-span-6", 7: "lg:col-span-7", 8: "lg:col-span-8",
  9: "lg:col-span-9", 10: "lg:col-span-10", 11: "lg:col-span-11", 12: "lg:col-span-12",
};

// 旧 size 档位 → 列数映射（迁移历史存档用：M27/M28 存的 full/twoThirds/half/third）
const LEGACY_SIZE_SPAN: Record<string, number> = { full: 12, twoThirds: 8, half: 6, third: 4 };

/** 纯函数：把存档里的 colSpan / 旧 size 折算成 1~12 的合法列数，脏值回落默认 */
export function coerceColSpan(rawColSpan: unknown, rawSize: unknown, defSpan: number): number {
  const clamp = (n: number) => Math.min(12, Math.max(1, Math.round(n)));
  if (typeof rawColSpan === "number" && Number.isFinite(rawColSpan)) return clamp(rawColSpan);
  if (typeof rawSize === "string" && rawSize in LEGACY_SIZE_SPAN) return LEGACY_SIZE_SPAN[rawSize];
  const fb = typeof defSpan === "number" && Number.isFinite(defSpan) ? defSpan : 12;
  return clamp(fb);
}

// 各卡默认列宽（对齐旧四档：full→12、half→6），DEFAULT_LAYOUT 与旧存档迁移共用。
const DEF_SPAN: Record<BlockId, number> = {
  hero: 12, scenes: 12, kpi: 12, contests: 12, programs: 6, events: 6, projects: 12,
};

export const DEFAULT_LAYOUT: BlockCfg[] = [
  { id: "hero", colSpan: 12, visible: true, fs: "md", skin: "default", fg: "auto" },
  { id: "scenes", colSpan: 12, visible: true, fs: "md", skin: "default", fg: "auto" },
  { id: "kpi", colSpan: 12, visible: true, fs: "md", skin: "default", fg: "auto" },
  { id: "contests", colSpan: 12, visible: true, fs: "md", skin: "default", fg: "auto" },
  { id: "programs", colSpan: 6, visible: true, fs: "md", skin: "default", fg: "auto" },
  { id: "events", colSpan: 6, visible: true, fs: "md", skin: "default", fg: "auto" },
  { id: "projects", colSpan: 12, visible: true, fs: "md", skin: "default", fg: "auto" },
];

const KEY = "queetai-dashboard-layout";

/** 布局变更事件：设置页点确定后派发，已打开的首页即时重排（同一浏览器标签内） */
export const LAYOUT_EVENT = "queetai-dashboard-layout";

const FONTS: FontScale[] = ["sm", "md", "lg", "xl"];
const FGS: FgChoice[] = ["auto", "dark", "light", "brand"];

function pickFont(v: unknown): FontScale {
  return FONTS.includes(v as FontScale) ? (v as FontScale) : "md";
}
function pickFg(v: unknown): FgChoice {
  return FGS.includes(v as FgChoice) ? (v as FgChoice) : "auto";
}
function pickSkin(v: unknown): SkinId {
  return SKIN_ORDER.includes(v as SkinId) ? (v as SkinId) : "default";
}

/**
 * 读取本机布局配置。
 * 与默认表按 id 合并：新增卡片自动补在末尾、已删除卡片的残留配置自动丢弃，顺序沿用保存的那份；
 * 旧版本存档（没有 fs/skin/fg 字段）自动补默认值，不会因为升级而炸页面。
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
    const r = raw as Partial<BlockCfg> & { size?: unknown };
    if (!r.id || !(r.id in BLOCK_LABELS)) continue;
    byId.set(r.id, {
      id: r.id,
      colSpan: coerceColSpan(r.colSpan, r.size, DEF_SPAN[r.id]),
      visible: r.visible !== false,
      fs: pickFont(r.fs),
      skin: pickSkin(r.skin),
      fg: pickFg(r.fg),
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
