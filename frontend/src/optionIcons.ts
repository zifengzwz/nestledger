import type { Component } from "vue";
import {
  Award,
  Baby,
  Bike,
  BookOpen,
  Camera,
  Car,
  Coffee,
  Heart,
  Music,
  PawPrint,
  Plane,
  Shirt,
  Smartphone,
  Sparkles,
  Wrench,
  Banknote,
  BriefcaseBusiness,
  BusFront,
  ChartNoAxesCombined,
  CircleEllipsis,
  Coins,
  CreditCard,
  Gamepad2,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Laptop,
  MessageCircle,
  QrCode,
  ShoppingBag,
  ShoppingBasket,
  Tag,
  Utensils,
  Wallet,
} from "lucide-vue-next";

export type OptionIconKind = "expense" | "income" | "payment";
export interface OptionIconDefinition {
  component: Component;
  key: string;
  color?: string;
}
export const iconChoices: Array<OptionIconDefinition & { label: string }> = [
  { key: "tag", component: Tag, label: "标签" },
  { key: "utensils", component: Utensils, label: "餐饮" },
  { key: "shopping-basket", component: ShoppingBasket, label: "日用" },
  { key: "bus-front", component: BusFront, label: "公交" },
  { key: "house", component: House, label: "住房" },
  { key: "shopping-bag", component: ShoppingBag, label: "购物" },
  { key: "gamepad", component: Gamepad2, label: "娱乐" },
  { key: "heart-pulse", component: HeartPulse, label: "医疗" },
  { key: "graduation-cap", component: GraduationCap, label: "教育" },
  { key: "gift", component: Gift, label: "礼物" },
  { key: "circle-ellipsis", component: CircleEllipsis, label: "其他" },
  { key: "briefcase-business", component: BriefcaseBusiness, label: "工资" },
  { key: "award", component: Award, label: "奖金" },
  { key: "chart", component: ChartNoAxesCombined, label: "投资" },
  { key: "laptop", component: Laptop, label: "兼职" },
  { key: "coins", component: Coins, label: "收入" },
  {
    key: "message-circle",
    component: MessageCircle,
    label: "微信",
    color: "#359b63",
  },
  { key: "qr-code", component: QrCode, label: "扫码", color: "#328cc3" },
  {
    key: "credit-card",
    component: CreditCard,
    label: "银行卡",
    color: "#7b7eac",
  },
  { key: "banknote", component: Banknote, label: "现金", color: "#a28b51" },
  { key: "wallet", component: Wallet, label: "钱包", color: "#789071" },
  { key: "paw-print", component: PawPrint, label: "宠物" },
  { key: "coffee", component: Coffee, label: "咖啡" },
  { key: "baby", component: Baby, label: "育儿" },
  { key: "smartphone", component: Smartphone, label: "手机" },
  { key: "plane", component: Plane, label: "旅行" },
  { key: "bike", component: Bike, label: "骑行" },
  { key: "car", component: Car, label: "汽车" },
  { key: "book-open", component: BookOpen, label: "书籍" },
  { key: "music", component: Music, label: "音乐" },
  { key: "camera", component: Camera, label: "摄影" },
  { key: "sparkles", component: Sparkles, label: "美好" },
  { key: "heart", component: Heart, label: "爱心" },
  { key: "shirt", component: Shirt, label: "服饰" },
  { key: "wrench", component: Wrench, label: "维修" },
];
export function iconById(id?: string): OptionIconDefinition | undefined {
  return typeof id === "string"
    ? iconChoices.find((icon) => icon.key === id)
    : undefined;
}
const expense: Record<string, OptionIconDefinition> = {
  餐饮美食: { component: Utensils, key: "utensils" },
  日用百货: { component: ShoppingBasket, key: "shopping-basket" },
  交通出行: { component: BusFront, key: "bus-front" },
  住房物业: { component: House, key: "house" },
  购物消费: { component: ShoppingBag, key: "shopping-bag" },
  休闲娱乐: { component: Gamepad2, key: "gamepad" },
  医疗健康: { component: HeartPulse, key: "heart-pulse" },
  教育学习: { component: GraduationCap, key: "graduation-cap" },
  人情往来: { component: Gift, key: "gift" },
  其他支出: { component: CircleEllipsis, key: "circle-ellipsis" },
};
const income: Record<string, OptionIconDefinition> = {
  工资薪酬: { component: BriefcaseBusiness, key: "briefcase-business" },
  奖金收入: { component: Award, key: "award" },
  投资理财: { component: ChartNoAxesCombined, key: "chart" },
  兼职收入: { component: Laptop, key: "laptop" },
  礼金收入: { component: Gift, key: "gift" },
  其他收入: { component: Coins, key: "coins" },
};
const payment: Record<string, OptionIconDefinition> = {
  微信: { component: MessageCircle, key: "message-circle", color: "#359b63" },
  支付宝: { component: QrCode, key: "qr-code", color: "#328cc3" },
  银行卡: { component: CreditCard, key: "credit-card", color: "#7b7eac" },
  现金: { component: Banknote, key: "banknote", color: "#a28b51" },
  其他: { component: Wallet, key: "wallet", color: "#789071" },
};
const aliases: Record<string, string> = {
  餐饮: "餐饮美食",
  交通: "交通出行",
  购物: "购物消费",
  工资: "工资薪酬",
  奖金: "奖金收入",
  微信支付: "微信",
  支付宝支付: "支付宝",
  银行卡支付: "银行卡",
  现金支付: "现金",
};
const own = (object: object, key: string) =>
  Object.prototype.hasOwnProperty.call(object, key);
export function optionIcon(
  kind: OptionIconKind,
  name: string,
): OptionIconDefinition {
  const registry =
    kind === "payment" ? payment : kind === "income" ? income : expense;
  const value = typeof name === "string" ? name.trim() : "";
  // Avoid prototype keys becoming accidental icons for user-entered names.
  if (own(registry, value)) return registry[value];
  if (own(aliases, value) && own(registry, aliases[value]))
    return registry[aliases[value]];
  return kind === "payment"
    ? { component: Wallet, key: "wallet", color: "#789071" }
    : kind === "income"
      ? { component: Coins, key: "coins" }
      : { component: Tag, key: "tag" };
}
