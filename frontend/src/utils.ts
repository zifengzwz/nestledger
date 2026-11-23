import type { Book, LedgerRecord } from "./api";
export const money = (cents: number) =>
  new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
export function toCents(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    throw new Error("金额应为正数，最多保留两位小数");
  const [whole, fraction = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 99999999999)
    throw new Error("金额需大于 0 且不超过 999,999,999.99 元");
  return cents;
}
export function shanghaiDay(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function localDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return parts.replace(" ", "T");
}
export function isoShanghai(value: string) {
  const date = new Date(
    `${value.length === 10 ? value + "T00:00" : value}:00+08:00`,
  );
  if (Number.isNaN(date.getTime())) throw new Error("请选择有效日期");
  return date.toISOString();
}
export function nextDayISO(day: string) {
  return new Date(
    new Date(isoShanghai(day)).getTime() + 86400000,
  ).toISOString();
}
export const recordDate = (value: string) => shanghaiDay(new Date(value));
export const canManage = (book: Book | undefined, userId: string) =>
  Boolean(book && book.ownerId === userId);
export const canEdit = (
  record: LedgerRecord,
  book: Book | undefined,
  userId: string,
) =>
  Boolean(book && !book.readOnly) &&
  (record.createdBy === userId || canManage(book, userId));


const categoryColors: Record<string, string> = {
  餐饮美食: "#c2410c",
  日用百货: "#0369a1",
  交通出行: "#0f766e",
  住房物业: "#7c3aed",
  购物消费: "#be185d",
  休闲娱乐: "#b45309",
  医疗健康: "#b91c1c",
  教育学习: "#1d4ed8",
  人情往来: "#a21caf",
  其他支出: "#475569",
  工资薪酬: "#15803d",
  奖金收入: "#a16207",
  投资理财: "#0e7490",
  兼职收入: "#6d28d9",
  礼金收入: "#db2777",
  其他收入: "#4b5563",
};
const categoryPalette = [
  "#0f766e",
  "#1d4ed8",
  "#b45309",
  "#be185d",
  "#7c3aed",
  "#15803d",
  "#c2410c",
  "#0e7490",
  "#a21caf",
  "#475569",
];
/** Stable colour for a major category: fixed defaults, deterministic for custom names. */
export function categoryColor(name: string) {
  if (Object.prototype.hasOwnProperty.call(categoryColors, name))
    return categoryColors[name];
  let hash = 0;
  for (const char of name)
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return categoryPalette[hash % categoryPalette.length];
}
