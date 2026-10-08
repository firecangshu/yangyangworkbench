// 中国日历辅助：基于离线历法库 lunar-typescript（纯本地计算，不联网），
// 为日历格子提供「二十四节气」与「公历/农历节日」标注。数据只读，符合红线④（不脑补日期）。
import { Solar } from "lunar-typescript";

export type DayMark = {
  /** 当日恰逢的节气名（仅节气交节当天有值），如「寒露」「霜降」 */
  jieqi: string | null;
  /** 当日主流节日（已过白名单过滤），如「国庆节」「重阳节」 */
  festivals: string[];
  /** 农历日，如「廿五」「初九」 */
  lunarDay: string;
};

// 只保留中国主流公历/农历节日，过滤掉“世界住房日/万圣节前夕”等国际纪念日噪声。
const FESTIVAL_WHITELIST = new Set([
  "元旦节", "情人节", "妇女节", "植树节", "劳动节", "青年节", "儿童节", "建党节", "建军节",
  "教师节", "国庆节", "记者节", "万圣节",
  "春节", "元宵节", "龙抬头", "上巳节", "清明节", "端午节", "七夕节", "中元节",
  "中秋节", "重阳节", "寒衣节", "下元节", "腊八节", "小年", "除夕",
]);

/**
 * 取某天的节气 / 节日 / 农历标注。
 * @param y 年 @param m 月(0基，同 Date) @param d 日
 */
export function dayMark(y: number, m: number, d: number): DayMark {
  const solar = Solar.fromYmd(y, m + 1, d); // lunar-typescript 月份为 1 基
  const lunar = solar.getLunar();
  const festivals = Array.from(new Set([...solar.getFestivals(), ...lunar.getFestivals()]))
    .filter((f) => FESTIVAL_WHITELIST.has(f));
  const isMonthStart = lunar.getDay() === 1;
  return {
    jieqi: lunar.getJieQi() || null,
    festivals,
    // 农历：初一显示「X月」，其余显示日（廿五/初九…）
    lunarDay: isMonthStart ? `${lunar.getMonthInChinese()}月` : lunar.getDayInChinese(),
  };
}

/**
 * 取某日所属农历年份的「干支年·生肖」标题，如「农历丙午年·马年」。
 * 以立春为界（getYearInGanZhiByLiChun），与万年历口径一致，符合红线④。
 * @param y 年 @param m 月(0基，同 Date) @param d 日
 */
export function lunarYearLabel(y: number, m: number, d: number): string {
  const lunar = Solar.fromYmd(y, m + 1, d).getLunar();
  return `农历${lunar.getYearInGanZhiByLiChun()}年·${lunar.getYearShengXiao()}年`;
}
