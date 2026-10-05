"use client";

// 首页卡片布局编辑器（M27 尺寸/顺序/显隐 + M28 卡内字号/卡片色/文字色）：
// 在「设置」页里把每张卡摆好，点「确定并应用」写进本机 localStorage，首页就固定成这个样子（首页上没有拖拽手柄，不会误碰）。
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BLOCK_LABELS,
  DEFAULT_LAYOUT,
  FONT_LABELS,
  FONT_MULT,
  FG_LABELS,
  SIZE_LABELS,
  SKINS,
  SKIN_ORDER,
  cardVars,
  hasColorOverride,
  loadLayout,
  resolveFg,
  saveLayout,
  type BlockCfg,
  type BlockId,
  type BlockSize,
  type FontScale,
  type FgChoice,
} from "@/lib/dashboard-layout";

const SIZES: BlockSize[] = ["full", "twoThirds", "half", "third"];
const FONTS: FontScale[] = ["sm", "md", "lg", "xl"];
const FGS: FgChoice[] = ["auto", "dark", "light", "brand"];
const SPAN_NUM: Record<BlockSize, number> = { full: 12, twoThirds: 8, half: 6, third: 4 };

function clone(list: BlockCfg[]): BlockCfg[] {
  return list.map((x) => ({ ...x }));
}

export function DashboardLayoutEditor() {
  const [draft, setDraft] = useState<BlockCfg[]>(() => clone(DEFAULT_LAYOUT));
  const [applied, setApplied] = useState<BlockCfg[]>(() => clone(DEFAULT_LAYOUT));
  const [msg, setMsg] = useState("");
  const dragId = useRef<BlockId | null>(null);

  // 首屏挂载后再读本机配置，避免 SSR 与客户端渲染不一致（hydration）
  useEffect(() => {
    const saved = loadLayout();
    setDraft(clone(saved));
    setApplied(clone(saved));
  }, []);

  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);

  const apply = useCallback(() => {
    saveLayout(draft);
    setApplied(clone(draft));
    setMsg(`✅ 已应用并固定：${draft.filter((d) => d.visible).length} 张卡片按当前组合显示在首页`);
  }, [draft]);

  const resetDefault = () => {
    setDraft(clone(DEFAULT_LAYOUT));
    setMsg("已恢复默认（尺寸/字号/配色全回原样，还没点确定，未生效）");
  };
  const revert = () => {
    setDraft(clone(applied));
    setMsg("");
  };

  function moveTo(id: BlockId, delta: number) {
    setDraft((list) => {
      const from = list.findIndex((x) => x.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return list;
      const next = clone(list);
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
  }

  function patch(id: BlockId, p: Partial<BlockCfg>) {
    setDraft((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }

  // 行拖拽换序：抓 ⠿ 掠过别的行即交换（只在设置页里能拖，首页是固定的）
  function onRowDrag(id: BlockId, overId: BlockId) {
    if (id === overId) return;
    setDraft((list) => {
      const from = list.findIndex((x) => x.id === id);
      const to = list.findIndex((x) => x.id === overId);
      if (from < 0 || to < 0) return list;
      const next = clone(list);
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });
  }

  const visibleCount = draft.filter((d) => d.visible).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-slate-500">
          在这页里把卡片<b className="text-slate-700">拖顺序、选宽度、调卡内字号、挑卡片色和文字色</b>，点「确定并应用」后首页就<b className="text-slate-700">固定</b>成这个样子。
          深底卡片会自动反白（不会调出看不清的组合）。配置只存本机浏览器（与主题同一处），不进数据库、不影响任何数据。
        </p>
        <div className="shrink-0 text-sm tabular-nums text-slate-500">
          当前 <span className="font-semibold text-slate-700">{visibleCount}</span> / {draft.length} 张显示
          {dirty && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">有未应用的修改</span>}
        </div>
      </div>

      {/* 实时预览：12 列栅格 + 与首页同一套配色/字号变量，所见即首页所得 */}
      <div className="rounded-lg bg-slate-50 p-3">
        <div className="mb-2 text-xs text-slate-500">首页预览（宽屏口径 · 灰掉划掉的是隐藏卡片）</div>
        <div className="grid grid-cols-12 gap-2">
          {draft.map((b) => {
            const colored = hasColorOverride(b);
            return (
              <div
                key={b.id}
                style={{
                  gridColumn: `span ${SPAN_NUM[b.size]} / span ${SPAN_NUM[b.size]}`,
                  ...cardVars(b),
                  ...(colored
                    ? {
                        background: b.skin === "default" ? undefined : SKINS[b.skin].bg,
                        color: resolveFg(b),
                      }
                    : undefined),
                  fontSize: `calc(0.875rem * ${FONT_MULT[b.fs]})`,
                }}
                className={`truncate rounded-md px-2 py-2.5 text-xs ${
                  colored ? "border" : b.visible ? "bg-brand-soft text-brand" : "bg-slate-200/70 text-slate-400 line-through"
                } ${b.visible ? "" : "line-through opacity-60"}`}
                title={`${BLOCK_LABELS[b.id]} · ${SIZE_LABELS[b.size]} · ${FONT_LABELS[b.fs]} · ${SKINS[b.skin].label}`}
              >
                {BLOCK_LABELS[b.id]}
              </div>
            );
          })}
        </div>
      </div>

      {/* 配置行 */}
      <div className="space-y-2">
        {draft.map((b, i) => (
          <div
            key={b.id}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragId.current && dragId.current !== b.id) {
                onRowDrag(dragId.current, b.id);
                dragId.current = b.id;
              }
            }}
            className={`rounded-lg border px-3 py-2.5 ${b.visible ? "bg-white" : "bg-slate-50 opacity-70"}`}
          >
            {/* 第一行：把手 / 序号 / 名称 / 宽档 / 字号 / 上下 / 显隐 */}
            <div className="flex flex-wrap items-center gap-3">
              <span
                draggable
                onDragStart={() => {
                  dragId.current = b.id;
                }}
                onDragEnd={() => {
                  dragId.current = null;
                }}
                className="cursor-grab select-none text-slate-300 hover:text-slate-500 active:cursor-grabbing"
                title="拖动换位置（也可用右侧上下按钮）"
              >
                ⠿
              </span>
              <span className="w-4 shrink-0 text-center text-xs tabular-nums text-slate-300">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={BLOCK_LABELS[b.id]}>
                {BLOCK_LABELS[b.id]}
              </span>

              <div className="flex rounded-lg border p-0.5">
                {SIZES.map((s) => (
                  <button
                    key={s}
                    onClick={() => patch(b.id, { size: s })}
                    className={`rounded-md px-2.5 py-1 text-xs ${
                      b.size === s ? "bg-brand font-medium text-white" : "text-slate-600 hover:bg-slate-50"
                    }`}
                    title="卡片占多宽"
                  >
                    {SIZE_LABELS[s]}
                  </button>
                ))}
              </div>

              <div className="flex rounded-lg border p-0.5">
                {FONTS.map((f) => (
                  <button
                    key={f}
                    onClick={() => patch(b.id, { fs: f })}
                    className={`rounded-md px-2.5 py-1 text-xs ${
                      b.fs === f ? "bg-brand font-medium text-white" : "text-slate-600 hover:bg-slate-50"
                    }`}
                    style={{ fontSize: `calc(0.75rem * ${FONT_MULT[f]})` }}
                    title={`卡内文字：${FONT_LABELS[f]}（×${FONT_MULT[f]}，仍随卡片宽度成比例）`}
                  >
                    {FONT_LABELS[f]}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => moveTo(b.id, -1)}
                  disabled={i === 0}
                  className="rounded border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-30"
                  title="上移"
                >
                  ↑
                </button>
                <button
                  onClick={() => moveTo(b.id, 1)}
                  disabled={i === draft.length - 1}
                  className="rounded border px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-30"
                  title="下移"
                >
                  ↓
                </button>
                <button
                  onClick={() => patch(b.id, { visible: !b.visible })}
                  className={`rounded px-2.5 py-1 text-xs ${
                    b.visible ? "bg-slate-100 text-slate-600 hover:bg-slate-200" : "bg-brand-soft text-brand"
                  }`}
                >
                  {b.visible ? "显示" : "已隐藏"}
                </button>
              </div>
            </div>

            {/* 第二行：卡片颜色色板 + 文字颜色 */}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 pl-7">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">卡片颜色</span>
                {SKIN_ORDER.map((s) => {
                  const skin = SKINS[s];
                  const on = b.skin === s;
                  return (
                    <button
                      key={s}
                      onClick={() => patch(b.id, { skin: s })}
                      title={skin.label}
                      className={`flex h-7 w-8 shrink-0 items-center justify-center rounded-md border ${
                        on ? "ring-2 ring-slate-500 ring-offset-1" : ""
                      }`}
                      style={
                        s === "default"
                          ? { background: "linear-gradient(135deg,#ffffff 50%,#dbe1ea 50%)" }
                          : { background: skin.bg, color: skin.fg }
                      }
                    >
                      <span className="text-xs leading-none font-semibold">Aa</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">文字颜色</span>
                <div className="flex rounded-lg border p-0.5">
                  {FGS.map((f) => (
                    <button
                      key={f}
                      onClick={() => patch(b.id, { fg: f })}
                      className={`rounded-md px-2 py-1 text-xs ${
                        b.fg === f ? "bg-brand font-medium text-white" : "text-slate-600 hover:bg-slate-50"
                      }`}
                      title={f === "auto" ? "跟随卡片颜色自动配（推荐）" : FG_LABELS[f]}
                    >
                      {FG_LABELS[f]}
                    </button>
                  ))}
                </div>
              </div>

              {b.skin !== "default" && (
                <span className="text-xs text-slate-400">
                  当前底色 {SKINS[b.skin].label}
                  {SKINS[b.skin].dark ? "（深底已自动反白）" : ""}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <button
          onClick={apply}
          disabled={!dirty}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          确定并应用
        </button>
        <button onClick={resetDefault} className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50">
          恢复默认组合
        </button>
        {dirty && (
          <button onClick={revert} className="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50">
            撤销未应用的修改
          </button>
        )}
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>
    </div>
  );
}
