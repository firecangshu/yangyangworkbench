"use client";

// 首页画板布局编辑器子页（M29）：挂 DashboardLayoutCanvas，配置只存本机、点确定同步首页。
import { DashboardLayoutCanvas } from "@/components/DashboardLayoutCanvas";

export default function LayoutEditorPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">首页画板布局编辑器</h1>
      <p className="text-sm text-slate-500">
        拖卡片排版首页：拖整块改顺序、拖右缘改宽度、点卡改配色。点「确定并应用」才同步到首页；配置只存本机，不入库。
      </p>
      <DashboardLayoutCanvas />
    </div>
  );
}
