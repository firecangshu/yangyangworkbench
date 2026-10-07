/**
 * 助手出口硬校验（M33 建立，M35 扩展）。
 *
 * 为什么不靠 prompt 自觉：M32 之后助手一个写工具都没有，但模型仍会声称「已登记」「已建文件夹」；
 * M35 又发现它会声称「已根据网址爬取」而它根本没有联网能力。prompt 里写了边界也拦不住，
 * 所以按句过滤在出口处兜底——安全不变量不能依赖 LLM 选路（同 M32 移除直写工具的判断）。
 *
 * 判据分两类，这个区别是 M35 新增的关键：
 *   FS_CLAIM / DB_CLAIM —— 永远做不到，无条件拦。
 *   NET_FETCH / NET_SEARCH —— read_url / search_web 上线后**可能是真话**，
 *     所以要看运行时能力标记 cap 决定拦不拦。调用成功过就不再误伤。
 */

/** 声称动过磁盘：建/存/写到本地（「建好」是模型实用的措词，M35 哨兵拓出来的） */
export const FS_CLAIM = /(创建|建立|新建|建起|建好|保存|写入|存放|存好|放好|准备好|生成|建了).{0,20}(文件夹|目录|磁盘|本地文件|workspace)|(建好了|建完了|创建完毕)/;
/**
 * 声称写过库：M32 后助手没有任何写工具，只能出预览。
 * 同一个谎有三种语序，缺一支等于没堵（前两支是活体测试里实际出现过的措辞）：
 *   「已登记这场比赛」「已将这场比赛登记进系统」「这场比赛的信息已经登记进来了」
 * 拆成源数组再拼接，是为了每条能单独写注释；单一巨正则已经难到没人敢改。
 */
const DB_CLAIM_SRC = [
  // 1. 主动语序，宾语在后
  "(已|已经).{0,12}(登记|录入|添加|新增|创建|保存|写入|存入|设置|安排).{0,16}(比赛|赛事|提醒|日历|交付物|材料|待办)",
  // 2. 把/将 字句
  "(已|已经).{0,12}(将|把).{0,16}(比赛|赛事|提醒|材料|交付物|信息).{0,12}(登记|录入|添加|保存|写入|存入|安排|设置)",
  // 3. 带写入目的地：已录入系统/台账/数据库
  "(已|已经).{0,12}(登记|录入|保存|写入|存入).{0,8}(进|到).{0,8}(系统|台账|数据库)",
  // 4. 完成态不带宾语：已登记好了 / 已经录入进来了 / 已帮你添加完
  "(已|已经).{0,8}(登记|录入|添加|保存|写入|存入).{0,4}(进|好|入|到|完毕|完成)",
  // 5. 主语在前的被动式：这场比赛的信息已经登记进来了
  "(比赛|赛事|提醒|材料|交付物|信息|资料).{0,10}(已|已经).{0,6}(登记|录入|添加|保存|写入|存入)",
  // 6. 已为你设置/安排…
  "(已|已经).{0,8}为(你|您).{0,12}(设置|添加|登记|安排)",
];
export const DB_CLAIM = new RegExp(DB_CLAIM_SRC.join("|"));
/** 声称抓过网页（read_url 未成功时才是假话） */
export const NET_FETCH = /(爬取|抓取|搜集|收集|检索|读取|访问|拉取|解析).{0,14}(网址|URL|url|链接|网页|官网|页面|站点)|(网址|URL|url|链接|网页|官网|页面).{0,14}(爬取|抓取|读取|访问|拉取|解析)|(已|已经).{0,8}联网/;
/** 声称搜过网（search_web 未成功时才是假话）——必须双向，“在网上搜索” 与 “搜索了网上” 都得接住 */
export const NET_SEARCH =
  /(在网上|网上|互联网上|百度上|谷歌上|网上面).{0,8}(搜索|搜了|搜过|查了|查过)|(搜索|搜了|搜过|查了|查过).{0,12}(网上|网络|互联网|搜索引擎|bing|百度|谷歌)|(已|已经).{0,8}(上网|联网搜索|联网查询)/i;

/** 第二人称建议是正当回答，不算假话 */
export const ADVICE = /(你可以|你也可以|你能|建议你|请自行|自行|自己建|手动|由你|你需要)/;
/** 完成态标记：同句带「已」时建议豁免失效 */
export const DONE_MARK = /我已经|我已|已经|已/;
/** 否定词：紧邻在动作之前说明这是实话（「我没有创建文件夹的能力」不能被删） */
const NEG = /(没有|无法|不能|没法|未能|没能|做不到|不具备|不支持|不可|不会|尚未|还未|没)/;

/** 否定是否紧邻出现在被指控的动作之前（窗口 14 字，避免「已建好文件夹，无法修改」被放过） */
function negatedBefore(sentence: string, at: number): boolean {
  for (const m of sentence.matchAll(new RegExp(NEG.source, "g"))) {
    const i = m.index ?? -1;
    if (i >= 0 && i < at && at - i <= 14) return true;
  }
  return false;
}

export type Capability = { fetch: boolean; search: boolean };
const NO_CAP: Capability = { fetch: false, search: false };

/** 该句是不是「声称做了自己做不到的事」；返回假话类别，null 表示放行 */
export function lieKind(sentence: string, cap: Capability = NO_CAP): "fs" | "net" | null {
  // 豁免三道：否定词紧邻在动作之前（实话）、否定词落在匹配串内部、第二人称建议（正当回答）。
  // 中间那道是 M35 补的：DB_CLAIM 的匹配以「已」开头，否定词却往往落在「已」与动词之间
  // （「已经核对过，这场比赛尚未登记进系统」），只看匹配起点以前的窗口会把这句实话删掉。
  const exempt = (at: number, span: string) =>
    negatedBefore(sentence, at) || NEG.test(span) || (ADVICE.test(sentence) && !DONE_MARK.test(sentence));

  const fs = FS_CLAIM.exec(sentence);
  const db = DB_CLAIM.exec(sentence);
  if (fs || db) {
    const at = Math.min(fs?.index ?? Infinity, db?.index ?? Infinity);
    if (!exempt(at, (fs?.[0] ?? "") + (db?.[0] ?? ""))) return "fs";
  }
  if (!cap.fetch) {
    const m = NET_FETCH.exec(sentence);
    if (m && !exempt(m.index ?? 0, m[0])) return "net";
  }
  if (!cap.search) {
    const m = NET_SEARCH.exec(sentence);
    if (m && !exempt(m.index ?? 0, m[0])) return "net";
  }
  return null;
}

export function isLie(sentence: string, cap: Capability = NO_CAP): boolean {
  return lieKind(sentence, cap) !== null;
}

const LIE_NOTE =
  "（说明：我没有写入台账的能力，也不能创建或改动任何文件/文件夹；台账里没登记的地址就是不存在的。要落库请在融入方案预览卡上点「确认融入」，要工作目录请你自己建，我可以把建议路径发给你。）";
const NET_NOTE =
  "（说明：我没能读到这个网址的内容——可能是内网地址被安全规则挡下、纯前端渲染、或者有人机验证。请把页面截图传进来，或把关键内容粘贴给我。）";

/**
 * 过滤假话句，并在确实删过东西时补一句实话。
 * 删句后会残留孤零零的括号和只剩标点的行，一并扫掉。
 */
export function sanitizeReply(text: string, cap: Capability = NO_CAP): string {
  const parts = text.split(/(?<=[。！？!?\n])/);
  const kept: string[] = [];
  let sawNet = false;
  let sawFs = false;
  for (const s of parts) {
    const k = lieKind(s, cap);
    if (k === "net") sawNet = true;
    else if (k === "fs") sawFs = true;
    else kept.push(s);
  }
  if (!sawNet && !sawFs) return text;
  const cleaned = kept
    .join("")
    .replace(/[（(【\[]\s*[）)】\]]/g, "")
    .split("\n")
    .filter((line) => !/^[\s\-*·.、,，;；:：!！?？()（）\[\]【】]*$/.test(line))
    .join("\n")
    .trim();
  const note = sawNet ? NET_NOTE : LIE_NOTE;
  return (cleaned ? cleaned + "\n" : "") + note;
}
