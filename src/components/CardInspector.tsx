"use client";
// 画板右侧属性栏（M29.2）：编辑当前选中卡的 显隐 / 卡内字号 / 文字色 / 卡片皮肤。
// 只改 draft（父组件持有），点「确定并应用」前不落库；配色全部复用 dashboard-layout 的常量，与首页同源。
import {
  BLOCK_LABELS,
  FG_LABELS,
  FONT_LABELS,
  SKINS,
  SKIN_ORDER,
  type BlockCfg,
} from "@/lib/dashboard-layout";

export function CardInspector({
  cfg,
  onPatch,
}: {
  cfg: BlockCfg;
  onPatch: (p: Partial<BlockCfg>) => void;
}) {
  // 通用分段选择器：点某档就 onPatch({ [key]: 该档 })
  const seg = <K extends keyof BlockCfg>(key: K, map: Record<string, string>, cur: unknown) => (
    <div className="flex rounded-lg border p-0.5">
      {Object.entries(map).map(([k, v]) => (
        <button
          key={k}
          onClick={() => onPatch({ [key]: k } as unknown as Partial<BlockCfg>)}
          className={`flex-1 rounded-md px-2 py-1 text-xs ${
            cur === k ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-50"
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium">{BLOCK_LABELS[cfg.id]}</div>

      <div>
        <div className="mb-1 text-xs text-slate-400">显示状态</div>
        <button
          onClick={() => onPatch({ visible: !cfg.visible })}
          className={`w-full rounded-lg border px-3 py-2 text-sm ${
            cfg.visible ? "hover:bg-slate-50" : "bg-brand-soft text-brand"
          }`}
        >
          {cfg.visible ? "✓ 显示中（点击隐藏）" : "已隐藏（点击显示）"}
        </button>
      </div>

      <div>
        <div className="mb-1 text-xs text-slate-400">卡内字号</div>
        {seg("fs", FONT_LABELS, cfg.fs)}
      </div>

      <div>
        <div className="mb-1 text-xs text-slate-400">文字颜色</div>
        {seg("fg", FG_LABELS, cfg.fg)}
      </div>

      <div>
        <div className="mb-1 text-xs text-slate-400">卡片颜色</div>
        <div className="flex flex-wrap gap-1.5">
          {SKIN_ORDER.map((id) => {
            const s = SKINS[id];
            const on = cfg.skin === id;
            return (
              <button
                key={id}
                title={s.label}
                onClick={() => onPatch({ skin: id })}
                className={`flex h-8 w-9 items-center justify-center rounded-md border text-xs font-semibold ${
                  on ? "ring-2 ring-slate-500 ring-offset-1" : ""
                }`}
                style={{
                  background: s.bg || "linear-gradient(135deg,#fff 50%,#dbe1ea 50%)",
                  color: s.fg,
                }}
              >
                Aa
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
