export const MAX_TRANSFER_BYTES = 10 * 1024 * 1024;
export const MAX_TRANSFER_RECORDS = 5000;
export const CSV_HEADERS = [
  "收支类型",
  "金额（元）",
  "分类",
  "小分类",
  "时间",
  "备注",
  "支付方式",
] as const;
export const LEGACY_CSV_HEADERS = CSV_HEADERS.filter(
  (header) => header !== "小分类",
);
export interface TransferRecord {
  type: "income" | "expense";
  amountCents: number;
  category: string;
  subcategory: string;
  occurredAt: string;
  note: string;
  paymentSource: string;
}
export interface Backup {
  format: "nestledger";
  version: 1;
  exportedAt: string;
  book: { name: string; type: "personal" | "family" };
  records: TransferRecord[];
}
export interface ParsedImport {
  records: TransferRecord[];
  lines: number[];
  sourceBook?: string;
}
const FIELDS = [
  "type",
  "amountCents",
  "category",
  "subcategory",
  "occurredAt",
  "note",
  "paymentSource",
];
const LEGACY_FIELDS = FIELDS.filter((field) => field !== "subcategory");
const dangerous = /^[\s]*[=+\-@\t\r\n]|^[\t\r\n]/;
export function safeCSVText(value: string): string {
  return dangerous.test(value) ? "'" + value : value;
}
export function restoreCSVText(value: string): string {
  return value.startsWith("'") && dangerous.test(value.slice(1))
    ? value.slice(1)
    : value;
}
export function centsDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("金额必须为整数分");
  const sign = cents < 0 ? "-" : "";
  const value = Math.abs(cents);
  return `${sign}${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}
export function parseMoney(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new Error("金额需为正数，最多两位小数，不支持科学计数法");
  const [whole, fraction = ""] = value.split(".");
  if (whole!.replace(/^0+/, "").length > 9)
    throw new Error("金额需为0.01–999999999.99元");
  // String arithmetic through BigInt avoids rounding even near the upper bound.
  const cents = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents < 1n || cents > 99999999999n)
    throw new Error("金额需为0.01–999999999.99元");
  return Number(cents);
}
function validCalendar(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return (
    year >= 1 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <=
      [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
        month - 1
      ]! &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59
  );
}
export function strictDate(value: string, allowShanghai = true): string {
  const iso =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;
  const local = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/;
  const match = value.match(iso) || (allowShanghai ? value.match(local) : null);
  if (
    !match ||
    !validCalendar(
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0),
    )
  )
    throw new Error(
      "时间需为有效ISO8601或北京时间 YYYY-MM-DD HH:mm[:ss]，请检查日期和时分秒",
    );
  const zone = match[8];
  if (
    zone &&
    zone !== "Z" &&
    (Number(zone.slice(1, 3)) > 14 ||
      Number(zone.slice(4)) > 59 ||
      (Number(zone.slice(1, 3)) === 14 && Number(zone.slice(4)) !== 0))
  )
    throw new Error("时区偏移无效");
  const normalized = zone
    ? value
    : `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] || "00"}+08:00`;
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime())) throw new Error("时间无效");
  return date.toISOString();
}
export function exportDateRange(from: string, to: string): URLSearchParams {
  const params = new URLSearchParams();
  const dayStart = (value: string) => strictDate(`${value} 00:00`);
  if (from) params.set("from", dayStart(from));
  if (to) {
    const end = new Date(dayStart(to));
    end.setUTCDate(end.getUTCDate() + 1);
    params.set("to", end.toISOString());
  }
  if (from && to && from > to) throw new Error("开始日期不能晚于结束日期");
  return params;
}
function textField(
  value: unknown,
  name: string,
  min: number,
  max: number,
): string {
  if (typeof value !== "string") throw new Error(`${name}必须是文本`);
  if (value.includes("\u0000")) throw new Error(`${name}不能含NUL字符`);
  if (
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      value,
    )
  )
    throw new Error(`${name}含无效Unicode字符`);
  const size = Array.from(value).length;
  if (size < min || size > max || (min > 0 && !value.trim()))
    throw new Error(`${name}需为${min}–${max}个字符`);
  return value;
}
export function validateRecord(value: unknown): TransferRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("记录必须为对象");
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some((key) => !FIELDS.includes(key)) ||
    LEGACY_FIELDS.some((key) => !(key in row))
  )
    throw new Error(
      "记录仅允许type、amountCents、category、subcategory、occurredAt、note、paymentSource字段，其中subcategory选填",
    );
  if (row.type !== "income" && row.type !== "expense")
    throw new Error("收支类型需为收入/支出（income/expense）");
  if (
    typeof row.amountCents !== "number" ||
    !Number.isSafeInteger(row.amountCents) ||
    row.amountCents <= 0 ||
    row.amountCents > 99999999999
  )
    throw new Error("amountCents需为1–99999999999的整数分");
  if (typeof row.occurredAt !== "string") throw new Error("时间必须是文本");
  strictDate(row.occurredAt, false);
  return {
    type: row.type,
    amountCents: row.amountCents,
    category: textField(row.category, "分类", 1, 40),
    subcategory:
      row.subcategory == null
        ? ""
        : textField(row.subcategory, "小分类", 0, 40),
    occurredAt: row.occurredAt,
    note: textField(row.note, "备注", 0, 500),
    paymentSource: textField(row.paymentSource, "支付方式", 0, 40),
  };
}
export function checkRecordCount(
  records: unknown,
  allowEmpty = false,
): asserts records is unknown[] {
  if (!Array.isArray(records)) throw new Error("records必须为JSON数组");
  if (
    (!allowEmpty && records.length === 0) ||
    records.length > MAX_TRANSFER_RECORDS
  )
    throw new Error("单次需有1–5000笔记录，请拆分文件或缩小日期范围");
}
export function parseJSONBackup(
  text: string,
  allowEmpty = false,
): ParsedImport {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("JSON格式无效，请选择NestLedger JSON备份");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("JSON备份必须为对象");
  const backup = value as Record<string, unknown>;
  if (backup.format !== "nestledger" || backup.version !== 1)
    throw new Error("仅支持nestledger格式、版本1的JSON备份");
  checkRecordCount(backup.records, allowEmpty);
  const records = backup.records.map((row, index) => {
    try {
      return validateRecord(row);
    } catch (error) {
      throw new Error(`第${index + 1}条记录：${(error as Error).message}`);
    }
  });
  const book = backup.book as Record<string, unknown> | undefined;
  const sourceBook =
    book && typeof book.name === "string"
      ? `${book.name}（${book.type === "family" ? "家庭" : book.type === "personal" ? "个人" : "未知类型"}）`
      : undefined;
  return { records, lines: records.map((_, index) => index + 1), sourceBook };
}
interface CSVRow {
  cells: string[];
  line: number;
}
export function parseCSVRows(text: string): CSVRow[] {
  text = text.replace(/^\uFEFF/, "");
  const rows: CSVRow[] = [];
  let cells: string[] = [],
    cell = "",
    quoted = false,
    closed = false,
    line = 1,
    start = 1;
  const fail = (message: string): never => {
    throw new Error(`第${line}行：${message}`);
  };
  const pushCell = () => {
    cells.push(cell);
    cell = "";
    closed = false;
  };
  const pushRow = () => {
    pushCell();
    rows.push({ cells, line: start });
    cells = [];
    start = line + 1;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        cell += ch;
        if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) line++;
      }
      continue;
    }
    if (ch === '"') {
      if (cell || closed) fail("引号只能出现在字段开头");
      quoted = true;
    } else if (ch === ",") pushCell();
    else if (ch === "\n" || ch === "\r") {
      pushRow();
      if (ch === "\r" && text[i + 1] === "\n") i++;
      line++;
      start = line;
    } else {
      if (closed) fail("闭合引号后只允许逗号或换行");
      cell += ch;
    }
  }
  if (quoted) fail("带引号的字段未闭合");
  if (cell || cells.length || closed) pushRow();
  while (
    rows.length &&
    rows[rows.length - 1]!.cells.every((cell) => cell === "")
  )
    rows.pop();
  return rows;
}
export function parseCSV(text: string): ParsedImport {
  const rows = parseCSVRows(text);
  const headers = rows.shift()?.cells;
  const isCurrent =
    headers &&
    headers.length === CSV_HEADERS.length &&
    headers.every((header) =>
      CSV_HEADERS.includes(header as (typeof CSV_HEADERS)[number]),
    );
  const isLegacy =
    headers &&
    headers.length === LEGACY_CSV_HEADERS.length &&
    headers.every((header) =>
      LEGACY_CSV_HEADERS.includes(
        header as (typeof LEGACY_CSV_HEADERS)[number],
      ),
    );
  if (
    !headers ||
    !(isCurrent || isLegacy) ||
    new Set(headers).size !== headers.length
  )
    throw new Error(
      `CSV表头必须为：${CSV_HEADERS.join(",")}（也兼容旧版无「小分类」的表头）`,
    );
  checkRecordCount(rows);
  const records = rows.map((row) => {
    try {
      if (row.cells.length !== headers.length)
        throw new Error(`应有${headers.length}列，实际${row.cells.length}列`);
      const field = (name: (typeof CSV_HEADERS)[number]) => {
        const index = headers.indexOf(name);
        return index >= 0 ? row.cells[index]! : "";
      };
      const type = field("收支类型");
      if (type !== "收入" && type !== "支出")
        throw new Error("收支类型仅允许收入或支出");
      return validateRecord({
        type: type === "收入" ? "income" : "expense",
        amountCents: parseMoney(field("金额（元）")),
        category: restoreCSVText(field("分类")),
        subcategory: restoreCSVText(field("小分类")),
        occurredAt: strictDate(field("时间")),
        note: restoreCSVText(field("备注")),
        paymentSource: restoreCSVText(field("支付方式")),
      });
    } catch (error) {
      throw new Error(`第${row.line}行：${(error as Error).message}`);
    }
  });
  return { records, lines: rows.map((row) => row.line) };
}
export function recordsCSV(records: TransferRecord[]): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return (
    "\uFEFF" +
    [
      CSV_HEADERS.map(quote).join(","),
      ...records.map((row) =>
        [
          row.type === "income" ? "收入" : "支出",
          centsDecimal(row.amountCents),
          safeCSVText(row.category),
          safeCSVText(row.subcategory),
          row.occurredAt,
          safeCSVText(row.note),
          safeCSVText(row.paymentSource),
        ]
          .map(quote)
          .join(","),
      ),
    ].join("\r\n") +
    "\r\n"
  );
}
export function templateCSV(): string {
  return recordsCSV([
    {
      type: "expense",
      amountCents: 1250,
      category: "餐饮美食",
      subcategory: "早餐",
      occurredAt: "2026-01-01T04:00:00.000Z",
      note: "示例记录：导入前请修改或删除",
      paymentSource: "微信",
    },
  ]);
}
export function parseImportFile(text: string, name: string): ParsedImport {
  if (new TextEncoder().encode(text).byteLength > MAX_TRANSFER_BYTES)
    throw new Error("文件不能超过10MiB");
  if (/\.csv$/i.test(name)) return parseCSV(text);
  if (/\.json$/i.test(name)) return parseJSONBackup(text);
  throw new Error("请选择.csv或.json文件");
}
export function importBody(
  requestId: string,
  records: TransferRecord[],
  dryRun: boolean,
) {
  const body = { requestId, records, dryRun };
  if (
    new TextEncoder().encode(JSON.stringify(body)).byteLength >
    MAX_TRANSFER_BYTES
  )
    throw new Error("解析后的请求超过10MiB，请拆分文件");
  return body;
}
export function safeFilename(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "_")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 80) || "账本"
  );
}
export function safeDownloadFilename(filename: string): string {
  const extension = filename.match(/\.(?:csv|json)$/i)?.[0];
  if (!extension) return safeFilename(filename);
  let base = safeFilename(filename.slice(0, -extension.length)).slice(
    0,
    80 - extension.length,
  );
  // Truncation must not split a supplementary Unicode character before the suffix.
  if (/[\uD800-\uDBFF]$/.test(base)) base = base.slice(0, -1);
  return `${base || "账本"}${extension}`;
}
export function downloadText(content: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeDownloadFilename(filename);
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
export function newRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
