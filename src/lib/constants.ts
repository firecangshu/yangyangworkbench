export const CATEGORY_LABELS: Record<string, string> = {
  skill: "Skill",
  product: "产品",
  contest: "比赛工程",
  patent: "专利",
  other: "其他",
};

export const STATUS_LABELS: Record<string, string> = {
  incubating: "孵化中",
  dev: "开发中",
  submitted: "已提交",
  maintain: "维护中",
  done: "完结",
};

export const STATUS_ORDER = ["incubating", "dev", "submitted", "maintain", "done"];

export const CONTEST_STATUS_LABELS: Record<string, string> = {
  research: "调研中",
  registered: "已报名",
  preparing: "准备中",
  submitted: "已提交",
  won: "已获奖",
  lost: "未中",
  cancelled: "已取消",
  expired: "已过期",
};

export const CONTEST_STATUS_ORDER = ["research", "registered", "preparing", "submitted", "won", "lost", "cancelled", "expired"];

export function daysUntil(dateStr: string): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr + "T00:00:00");
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86400000);
}
