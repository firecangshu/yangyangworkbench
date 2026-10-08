"use client";
// 首页画板布局编辑器主体（M29.2 骨架，M29.3 拖序 / M29.4 拖宽 后续接入）。
// 三栏：左「卡片库/已隐藏」· 中「12 列画板」· 右「属性栏」+ 顶部工具条。
// draft/applied 双态：所有改动只动 draft，点「确定并应用」才 saveLayout 落 localStorage 并同步首页（红线①⑤：只存本机不入库）。
// 画板里的代理卡与首页 Block 用同一套 data-skin/data-skin-tone/data-fg/cardVars/COL_SPAN_CLASS —— 所见即首页。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BLOCK_LABELS,
  COL_SPAN_CLASS,
  DEFAULT_LAYOUT,
  FONT_MULT,
  cardVars,
  loadLayout,
  saveLayout,
  skinTone,
  type BlockCfg,
  type BlockId,
} from "@/lib/dashboard-layout";
import { CardInspector } from "./CardInspector";

const clone = (l: BlockCfg[]) => l.map((x) => ({ ...x }));

export function DashboardLayoutCanvas() {
  const [draft, setDraft] = useState<BlockCfg[]>(() => clone(DEFAULT_LAYOUT));
  const [applied, setApplied] = useState<BlockCfg[]>(() => clone(DEFAULT_LAYOUT));
  const [sel, setSel] = useState<BlockId | null>(null);
  const [msg, setMsg] = useState("");
  // M29.4 拖右缘改宽度的缩放态：记住起点 x、起始 colSpan、每列像素宽（吸附整列）
  const [rz, setRz] = useState<{
    id: BlockId;
    startX: number;
    startSpan: number;
    colUnit: number;
  } | null>(null);

  // 首帧用 DEFAULT 保 hydration 一致，挂载后再读本机配置
  useEffect(() => {
    const s = loadLayout();
    setDraft(clone(s));
    setApplied(clone(s));
  }, []);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(applied),
    [draft, applied],
  );
  const visible = draft.filter((c) => c.visible);
  const hidden = draft.filter((c) => !c.visible);
  const cur = draft.find((c) => c.id === sel) || null;

  // 属性栏改当前选中卡
  const patch = useCallback(
    (p: Partial<BlockCfg>) => {
      setDraft((l) => l.map((x) => (x.id === sel ? { ...x, ...p } : x)));
    },
    [sel],
  );

  // 从卡片库把隐藏卡放回（追加到可见序列末尾）
  const restore = (id: BlockId) =>
    setDraft((l) => {
      const vis = l.filter((x) => x.visible);
      const hid = l.filter((x) => !x.visible);
      const target = hid.find((x) => x.id === id);
      if (!target) return l;
      return [...vis, { ...target, visible: true }, ...hid.filter((x) => x.id !== id)];
    });

  // M29.3 拖 ⠿ 改整卡顺序：只在「可见卡」之间换位，隐藏卡一律尾随（不串行到可见区）。
  const dragId = useRef<BlockId | null>(null);
  const onDropReorder = (overId: BlockId) => {
    const from = dragId.current;
    dragId.current = null;
    if (!from || from === overId) return;
    setDraft((l) => {
      const vis = l.filter((x) => x.visible);
      const hid = l.filter((x) => !x.visible);
      const fi = vis.findIndex((x) => x.id === from);
      const ti = vis.findIndex((x) => x.id === overId);
      if (fi < 0 || ti < 0) return l;
      const [moved] = vis.splice(fi, 1);
      // 向前拖（fi<ti）时，移除源卡后目标已左移一位，需插到 ti-1，才能让被拖卡落在目标原位（而非其之后）。
      vis.splice(fi < ti ? ti - 1 : ti, 0, moved);
      const order = [...vis, ...hid].map((o) => o.id);
      return order.map((id) => l.find((x) => x.id === id)!);
    });
  };

  const apply = () => {
    saveLayout(draft);
    setApplied(clone(draft));
    setMsg(`已同步：${draft.filter((c) => c.visible).length} 张卡固定到首页`);
  };

  // M29.4 手柄按下：以画板网格实际宽度折算「一列多少像素」，位移除以它 = 增减列数（四舍五入吸附整列）。
  const startRz = (e: React.PointerEvent, c: BlockCfg) => {
    e.preventDefault();
    e.stopPropagation();
    const grid = document.getElementById("canvas") as HTMLElement | null;
    if (!grid) return;
    const gap = 16; // 与 gap-4 对齐
    const colUnit = (grid.clientWidth + gap) / 12;
    setSel(c.id);
    setRz({ id: c.id, startX: e.clientX, startSpan: c.colSpan, colUnit });
  };

  // rz 非空期间挂全局 pointermove/pointerup：拖动实时改 colSpan（clamp 1~12），松手结束。
  useEffect(() => {
    if (!rz) return;
    const move = (e: PointerEvent) => {
      const dc = Math.round((e.clientX - rz.startX) / rz.colUnit);
      const ns = Math.min(12, Math.max(1, rz.startSpan + dc));
      setDraft((l) => l.map((x) => (x.id === rz.id ? { ...x, colSpan: ns } : x)));
    };
    const up = () => setRz(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up); // 手势中断/失焦也收尾，防监听器残留持续误改 colSpan
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [rz]);
  const undo = () => {
    setDraft(clone(applied));
    setMsg("");
  };
  const reset = () => {
    setDraft(clone(DEFAULT_LAYOUT));
    setMsg("已恢复默认（未点确定，不生效）");
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 顶部工具条 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-500">拖动 ⠿ 改顺序 · 拖右缘改宽度 · 点卡改配色</span>
        <div className="flex-1" />
        {dirty && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            有未应用的修改
          </span>
        )}
        <button onClick={undo} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">
          撤销
        </button>
        <button onClick={reset} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">
          恢复默认
        </button>
        <button
          onClick={apply}
          disabled={!dirty}
          className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          确定并应用
        </button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* 左：卡片库 / 已隐藏 */}
        <aside className="shrink-0 rounded-xl border bg-white p-3 lg:w-44">
          <div className="mb-2 text-xs text-slate-400">卡片库 / 已隐藏</div>
          {hidden.length === 0 ? (
            <div className="text-xs text-slate-300">没有隐藏的卡</div>
          ) : (
            hidden.map((c) => (
              <button
                key={c.id}
                onClick={() => restore(c.id)}
                className="mb-1 block w-full rounded-md border border-dashed px-2 py-1.5 text-left text-xs text-slate-500 hover:border-brand hover:text-brand"
              >
                ↩ {BLOCK_LABELS[c.id]}
              </button>
            ))
          )}
        </aside>

        {/* 中：画板（与首页同款 12 列 flow grid，永不重叠） */}
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-12" id="canvas">
          {visible.map((c) => (
            // 结构与首页 Block 完全对齐：外层带 data-skin/cardVars，内层才是 .card-fluid
            // （globals.css 用后代选择器 [data-skin] .card-fluid 上色，同元素不匹配）。
            <div
              key={c.id}
              data-id={c.id}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onDropReorder(c.id);
              }}
              data-skin={c.skin !== "default" ? c.skin : undefined}
              data-skin-tone={skinTone(c.skin) ?? undefined}
              data-fg={c.fg !== "auto" ? c.fg : undefined}
              style={{ ...cardVars(c) } as React.CSSProperties}
              className={`min-w-0 ${COL_SPAN_CLASS[c.colSpan] ?? "lg:col-span-12"}`}
            >
              <div
                onClick={() => setSel(c.id)}
                className={`card-fluid group relative h-full cursor-pointer rounded-xl border p-4 ${
                  sel === c.id ? "ring-2 ring-brand" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation();
                      dragId.current = c.id;
                    }}
                    onDragEnd={() => (dragId.current = null)}
                    title="拖到别的卡上换顺序"
                    className="cursor-grab select-none text-slate-300"
                  >
                    ⠿
                  </span>
                  <span className="flex-1 truncate text-sm font-medium">{BLOCK_LABELS[c.id]}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums">
                    占 {c.colSpan}/12
                  </span>
                </div>
                <div className="mt-1 text-xs opacity-70">
                  字号 ×{FONT_MULT[c.fs]} · {c.colSpan} 列宽
                </div>
                {/* M29.4 右缘缩放手柄：按住左右拖，按整列吸附改 colSpan */}
                <span
                  onPointerDown={(e) => startRz(e, c)}
                  title="拖动改宽度（占几列）"
                  className="absolute -right-1 top-0 z-10 flex h-full w-3 cursor-ew-resize touch-none items-center justify-center"
                >
                  <i
                    className={`block h-2/3 w-1 rounded ${
                      rz?.id === c.id ? "bg-brand" : "bg-transparent group-hover:bg-brand/40"
                    }`}
                  />
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* 右：属性栏 */}
        <aside className="shrink-0 rounded-xl border bg-white p-4 lg:w-64">
          {cur ? (
            <CardInspector cfg={cur} onPatch={patch} />
          ) : (
            <p className="text-center text-sm text-slate-400">
              点画板里任意一张卡
              <br />
              在此调显隐 / 字号 / 配色
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
