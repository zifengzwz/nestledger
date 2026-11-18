import { describe, expect, it } from "vitest";
import {
  canEdit,
  canManage,
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
  });
});
