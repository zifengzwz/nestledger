import { describe, expect, it } from "vitest";
import {
  canEdit,
  canManage,
  categoryColor,
  isoShanghai,
  localDateTime,
  money,
  nextDayISO,
  shanghaiDay,
  toCents,
} from "../utils";
import type { Book, LedgerRecord } from "../api";
describe("integer-cent monetary conversion", () => {
  it("preserves precision without rounding floating point", () => {
    expect(toCents("0.29")).toBe(29);
    expect(toCents("12.1")).toBe(1210);
    expect(toCents("999999999.99")).toBe(99999999999);
    expect(money(123456)).toBe("1,234.56");
  });
  it.each(["0", "-1", "1.234", "1e3", "abc", "1000000000", "Infinity", ""])(
    "rejects invalid amount %s",
    (value) => expect(() => toCents(value)).toThrow(),
  );
});
describe("Shanghai dates independent of device timezone", () => {
  it("uses UTC+8 for day boundaries", () => {
    expect(isoShanghai("2026-11-16")).toBe("2026-11-15T16:00:00.000Z");
    expect(isoShanghai("2026-11-16T19:30")).toBe("2026-11-16T11:30:00.000Z");
    expect(nextDayISO("2026-11-30")).toBe("2026-11-30T16:00:00.000Z");
  });
  it("formats current Shanghai date and datetime", () => {
    const date = new Date("2026-11-15T18:05:00Z");
    expect(shanghaiDay(date)).toBe("2026-11-16");
    expect(localDateTime(date)).toBe("2026-11-16T02:05");
  });
});
describe("category colours", () => {
  it("gives every default major category a distinct, stable colour", () => {
    const names = [
      "餐饮美食",
      "日用百货",
      "交通出行",
      "住房物业",
      "购物消费",
      "休闲娱乐",
      "医疗健康",
      "教育学习",
      "人情往来",
      "其他支出",
      "工资薪酬",
      "奖金收入",
      "投资理财",
      "兼职收入",
      "礼金收入",
      "其他收入",
    ];
    const colors = names.map(categoryColor);
    expect(new Set(colors).size).toBe(names.length);
    expect(categoryColor("餐饮美食")).toBe("#c2410c");
    expect(categoryColor("交通出行")).toBe("#0f766e");
  });
  it("derives deterministic palette colours for custom categories", () => {
    expect(categoryColor("宠物开销")).toBe(categoryColor("宠物开销"));
    expect(categoryColor("宠物开销")).toMatch(/^#[0-9a-f]{6}$/);
    expect(categoryColor("")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
describe("visible permission controls", () => {
  const book = { ownerId: "owner" } as Book,
    record = { createdBy: "creator" } as LedgerRecord;
  it("allows owner only to manage", () => {
    expect(canManage(book, "owner")).toBe(true);
    expect(canManage(book, "member")).toBe(false);
    expect(canManage(undefined, "owner")).toBe(false);
  });
  it("allows creator or owner to edit records", () => {
    expect(canEdit(record, book, "owner")).toBe(true);
    expect(canEdit(record, book, "creator")).toBe(true);
    expect(canEdit(record, book, "member")).toBe(false);
    expect(
      canEdit(record, { ...book, readOnly: true }, "creator"),
    ).toBe(false);
  });
});
