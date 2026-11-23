import { describe, expect, it, vi, afterEach } from "vitest";
import {
  CSV_HEADERS,
  centsDecimal,
  downloadText,
  exportDateRange,
  importBody,
  MAX_TRANSFER_BYTES,
  parseCSV,
  parseCSVRows,
  parseImportFile,
  parseJSONBackup,
  parseMoney,
  recordsCSV,
  restoreCSVText,
  safeCSVText,
  safeFilename,
  safeDownloadFilename,
  strictDate,
  templateCSV,
  type TransferRecord,
} from "../dataTransfer";
const row: TransferRecord = {
  type: "expense",
  amountCents: 29,
  category: "餐饮美食",
  subcategory: "咖啡",
  occurredAt: "2026-11-17T01:02:03.123Z",
  note: '咖啡, "好喝"\r\n第二行',
  paymentSource: "微信",
};
const backup = (records: unknown = [row]) =>
  JSON.stringify({
    format: "nestledger",
    version: 1,
    exportedAt: "2026-11-17T00:00:00.000Z",
    book: { name: "旧账本", type: "family" },
    records,
  });
const csvRow = (changes: string[] = []) =>
  CSV_HEADERS.join(",") +
  "\n" +
  (changes.length
    ? changes
    : ["支出", "0.29", "餐饮", "2026-11-17 09:00", "备注", "微信"]
  ).join(",");
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("exact integer-cent money", () => {
  it.each([
    ["0.29", 29],
    ["12", 1200],
    ["1.2", 120],
    ["0001.01", 101],
    ["999999999.99", 99999999999],
  ])("parses %s without floating rounding", (value, cents) =>
    expect(parseMoney(String(value))).toBe(cents),
  );
  it.each([
    "0",
    "0.00",
    "-1",
    "+1",
    "1e2",
    "1.001",
    "1.",
    ".5",
    "NaN",
    "1000000000",
    " 1",
    "1,000",
  ])('rejects "%s"', (value) => expect(() => parseMoney(value)).toThrow());
  it("exports cents without scientific notation", () => {
    expect(centsDecimal(99999999999)).toBe("999999999.99");
    expect(centsDecimal(29)).toBe("0.29");
  });
});
describe("strict calendar and export date range", () => {
  it("accepts leap day, Shanghai minute/second, UTC milliseconds and explicit offset", () => {
    expect(strictDate("2024-02-29 09:30")).toBe("2024-02-29T01:30:00.000Z");
    expect(strictDate("2024-02-29 09:30:12")).toBe("2024-02-29T01:30:12.000Z");
    expect(strictDate(row.occurredAt)).toBe(row.occurredAt);
    expect(strictDate("2024-02-29T09:30:00+08:00")).toBe(
      "2024-02-29T01:30:00.000Z",
    );
  });
  it.each([
    "2026-02-29 09:00",
    "2024-02-30 09:00",
    "2026-04-31T09:00:00Z",
    "2026-13-01 00:00",
    "2026-00-01 00:00",
    "2026-01-00 00:00",
    "2026-01-01 24:00",
    "2026-01-01 12:60",
    "2026-01-01 12:00:60",
    "2026-01-01",
    "2026-01-01T12:00:00",
    "2026-01-01T12:00:00+24:00",
    "2026-01-01T12:00:00+08:60",
    "2026-01-01T12:00:00+15:00",
    "2026-01-01T12:00:00-15:00",
    "2026-01-01T12:00:00+14:01",
    "2026-01-01T12:00:00-14:01",
  ])('rejects invalid date "%s"', (value) =>
    expect(() => strictDate(value)).toThrow(),
  );
  it.each(["+14:00", "-14:00", "+13:59", "-13:59"])(
    "accepts valid boundary offset %s",
    (zone) => {
      expect(() => strictDate(`2026-01-01T12:00:00${zone}`)).not.toThrow();
    },
  );
  it.each(["+15:00", "-15:00", "+14:01", "-14:01"])(
    "rejects invalid CSV offset %s before normalization",
    (zone) => {
      expect(() =>
        parseCSV(
          csvRow([
            "支出",
            "1",
            "餐饮",
            "",
            `2026-01-01T12:00:00${zone}`,
            "",
            "微信",
          ]),
        ),
      ).toThrow("第2行：时区偏移无效");
      expect(() =>
        parseJSONBackup(
          backup([{ ...row, occurredAt: `2026-01-01T12:00:00${zone}` }]),
        ),
      ).toThrow("时区偏移无效");
    },
  );
  it("exports an inclusive Shanghai end date as exclusive next day", () => {
    expect(
      Object.fromEntries(exportDateRange("2026-11-01", "2026-11-17")),
    ).toEqual({
      from: "2026-10-31T16:00:00.000Z",
      to: "2026-11-17T16:00:00.000Z",
    });
    expect(() => exportDateRange("2026-11-18", "2026-11-17")).toThrow(
      "开始日期",
    );
    expect(exportDateRange("", "").toString()).toBe("");
  });
});
describe("CSV parsing and spreadsheet safety", () => {
  it("roundtrips BOM, quoted commas/quotes/multiline, exact cents and milliseconds", () => {
    const text = recordsCSV([row]);
    expect(text[0]).toBe("\uFEFF");
    expect(parseCSV(text).records).toEqual([row]);
  });
  it("uses physical row numbers after multiline cells", () => {
    const rows = parseCSVRows('a,b\r\n"one\r\ntwo",x\r\nthree,y');
    expect(rows.map((row) => row.line)).toEqual([1, 2, 4]);
  });
  it("supports reordered whitelist headers and ignores empty trailing rows", () => {
    const text =
      "金额（元）,收支类型,分类,时间,备注,支付方式\n12.30,收入,工资,2026-01-01 12:00,,现金\n\n";
    expect(parseCSV(text).records[0]).toMatchObject({
      type: "income",
      amountCents: 1230,
      subcategory: "",
    });
  });
  it("downloads a valid template with previewable example", () =>
    expect(parseCSV(templateCSV()).records).toHaveLength(1));
  it.each([
    "a,b\n1,2",
    CSV_HEADERS.join(",").replace("支付方式", "分类") + "\n1",
    CSV_HEADERS.join(",").replace("支付方式", "未知") + "\n1",
    csvRow() + ",extra",
    csvRow(["expense", "1", "餐饮", "", "2026-01-01 12:00", "", ""]),
    csvRow(["支出", "1.234", "餐饮", "", "2026-01-01 12:00", "", ""]),
    csvRow(["支出", "1", "餐饮", "", "2026-02-30 12:00", "", ""]),
    csvRow().replace("备注", '"未闭合'),
    csvRow().replace("备注", 'a"b'),
    csvRow().replace("备注", '"a"b'),
  ])("rejects malformed CSV", (text) => expect(() => parseCSV(text)).toThrow());
  it("includes the offending row number", () =>
    expect(() =>
      parseCSV(csvRow(["支出", "1e3", "餐饮", "", "2026-01-01 12:00", "", ""])),
    ).toThrow("第2行"));
  it.each([
    "=SUM(A1:A2)",
    "+cmd",
    "-1",
    "@evil",
    "  =1",
    "\tcmd",
    "\rtest",
    "\ntest",
    "  \n=cmd",
  ])(
    'safely prefixes dangerous "%s" and only reverses that pattern',
    (value) => {
      expect(safeCSVText(value)).toBe("'" + value);
      expect(restoreCSVText(safeCSVText(value))).toBe(value);
      expect(
        parseCSV(
          recordsCSV([
            { ...row, category: value, note: value, paymentSource: value },
          ]),
        ).records[0],
      ).toMatchObject({ category: value, note: value, paymentSource: value });
    },
  );
  it("does not strip ordinary apostrophes or execute malicious text", () => {
    expect(restoreCSVText("'hello")).toBe("'hello");
    expect(
      parseCSV(
        recordsCSV([
          {
            ...row,
            note: '<img src=x onerror="alert(1)">',
            category: "__proto__",
          },
        ]),
      ).records[0]!.category,
    ).toBe("__proto__");
  });
});
describe("JSON schema, whitelist and size caps", () => {
  it.each(["category", "note", "paymentSource"] as const)(
    "rejects NUL in %s in both CSV and JSON before API validation",
    (field) => {
      const malicious = { ...row, [field]: "文本\u0000内容" };
      expect(() => parseJSONBackup(backup([malicious]))).toThrow(
        "不能含NUL字符",
      );
      expect(() => parseCSV(recordsCSV([malicious]))).toThrow("第2行");
      expect(() => parseCSV(recordsCSV([malicious]))).toThrow("不能含NUL字符");
    },
  );
  it("preserves the original fields, tolerates legacy records without a subcategory and treats source book as information", () => {
    expect(parseJSONBackup(backup()).records).toEqual([row]);
    const legacyRow = { ...row } as Record<string, unknown>;
    delete legacyRow.subcategory;
    expect(parseJSONBackup(backup([legacyRow])).records[0]!.subcategory).toBe(
      "",
    );
    expect(parseJSONBackup(backup()).sourceBook).toContain("旧账本");
  });
  it.each([
    "[]",
    "null",
    "{}",
    "invalid",
    backup({}),
    backup([]),
    backup([{ ...row, id: "malicious" }]),
    backup([{ ...row, createdBy: "other" }]),
    backup([{ ...row, amountCents: "29" }]),
    backup([{ ...row, amountCents: 0.29 }]),
    backup([{ ...row, note: 1 }]),
    backup([{ ...row, category: "" }]),
    backup([{ ...row, note: "x".repeat(501) }]),
    backup([{ ...row, category: "x".repeat(41) }]),
    backup([{ ...row, subcategory: 1 }]),
    backup([{ ...row, subcategory: "x".repeat(41) }]),
    backup([{ ...row, paymentSource: null }]),
    backup([{ ...row, occurredAt: "2026-02-30T00:00:00Z" }]),
    backup([{ ...row, occurredAt: "2026-01-01 12:00" }]),
    backup([{ ...row, note: "\ud800" }]),
  ])("rejects invalid JSON records", (text) =>
    expect(() => parseJSONBackup(text)).toThrow(),
  );
  it("rejects unsupported format/version", () => {
    expect(() =>
      parseJSONBackup(backup().replace('"version":1', '"version":2')),
    ).toThrow("版本1");
    expect(() =>
      parseJSONBackup(backup().replace('"nestledger"', '"other"')),
    ).toThrow("nestledger");
  });
  it("allows empty export but disallows empty import, enforces 5000 records", () => {
    expect(parseJSONBackup(backup([]), true).records).toEqual([]);
    expect(parseJSONBackup(backup(Array(5000).fill(row))).records).toHaveLength(
      5000,
    );
    expect(() => parseJSONBackup(backup(Array(5001).fill(row)))).toThrow(
      "5000",
    );
  });
  it("caps file and serialized request sizes in UTF8 bytes", () => {
    expect(() =>
      parseImportFile("x".repeat(MAX_TRANSFER_BYTES + 1), "data.csv"),
    ).toThrow("10MiB");
    expect(() =>
      importBody(
        "token",
        Array(5000).fill({ ...row, note: "汉".repeat(1000) }),
        false,
      ),
    ).toThrow("10MiB");
    expect(() => parseImportFile(backup(), "data.js")).toThrow(".csv");
  });
  it.each([".csv", ".json", ".JSON"])(
    "preserves %s download extensions for long Unicode book names",
    (extension) => {
      const bookName = "🏡".repeat(40);
      const input = `${safeFilename(bookName)}-备份${extension}`;
      const filename = safeDownloadFilename(input);
      expect(filename.endsWith(extension)).toBe(true);
      expect(filename.length).toBeLessThanOrEqual(80);
      expect(filename).not.toMatch(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
      );
      vi.stubGlobal("URL", {
        createObjectURL: vi.fn(() => "blob:long-name"),
        revokeObjectURL: vi.fn(),
      });
      let actualFilename = "";
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
        function (this: HTMLAnchorElement) {
          actualFilename = this.download;
        },
      );
      downloadText(
        "data",
        input,
        extension.toLowerCase() === ".csv" ? "text/csv" : "application/json",
      );
      expect(actualFilename).toBe(filename);
    },
  );
  it("sanitizes filenames and revokes the Blob URL after triggering a download", () => {
    vi.useFakeTimers();
    const create = vi.fn(() => "blob:test"),
      revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    downloadText("data", "<script>/evil.csv", "text/csv");
    expect(click).toHaveBeenCalledOnce();
    expect(safeFilename("<script>/evil.csv")).not.toMatch(/[<>/]/);
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:test");
    vi.useRealTimers();
  });
});
