import type { ThemeId } from "./theme";

export type UserTheme = ThemeId;
export interface User {
  id: string;
  phone: string;
  name: string;
  createdAt: string;
  theme?: UserTheme;
}
export interface Book {
  id: string;
  name: string;
  type: "personal" | "family";
  ownerId: string;
  memberIds: string[];
  createdAt: string;
  /** True when the book was shared with this account and can only be viewed. */
  readOnly?: boolean;
  /** Original owner shown to read-only recipients so they know whose ledger it is. */
  ownerName?: string;
  ownerPhone?: string;
}
export interface Invitation {
  id: string;
  bookId: string;
  bookName: string;
  inviterName: string;
  phone: string;
  status: string;
  createdAt: string;
}
export type BookShareStatus = "pending" | "accepted" | "rejected";
export interface BookShare {
  id: string;
  userId: string;
  name: string;
  phone: string;
  status: BookShareStatus;
  createdAt: string;
}
export interface BookShares {
  ownerId: string;
  shares: BookShare[];
}
export interface ReceivedBookShare {
  id: string;
  bookId: string;
  bookName: string;
  ownerName: string;
  ownerPhone: string;
  createdAt: string;
}
export interface LedgerRecord {
  id: string;
  bookId: string;
  createdBy: string;
  createdByName?: string;
  type: "income" | "expense";
  amountCents: number;
  category: string;
  occurredAt: string;
  note: string;
  paymentSource: string;
  createdAt: string;
  updatedAt: string;
}
export interface RecordOptions {
  expenseCategories: string[];
  incomeCategories: string[];
  paymentSources: string[];
  icons?: Partial<Record<RecordOptionKind, Record<string, string>>>;
}
export type RecordOptionKind =
  "expenseCategory" | "incomeCategory" | "paymentSource";
export interface RecordAuthor {
  id: string;
  name: string;
}
export interface RecordPage {
  items: LedgerRecord[];
  total: number;
  page: number;
  pageSize: number;
  authors?: RecordAuthor[];
}
export interface Analysis {
  period: string;
  from: string;
  to: string;
  incomeCents: number;
  expenseCents: number;
  balanceCents: number;
  recordCount: number;
  trend: { label: string; incomeCents: number; expenseCents: number }[];
  categories: { category: string; amountCents: number; count: number }[];
  members: AnalysisMember[];
  books?: AnalysisBook[];
}
export interface AnalysisBook {
  bookId: string;
  name: string;
  incomeCents: number;
  expenseCents: number;
  balanceCents: number;
  recordCount: number;
}
export interface AnalysisMember {
  userId: string;
  name: string;
  incomeCents: number;
  expenseCents: number;
  balanceCents: number;
  recordCount: number;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    const hasBody = body !== undefined || !["GET", "HEAD"].includes(method);
    response = await fetch(`/api${path}`, {
      method,
      credentials: "include",
      headers: hasBody ? { "Content-Type": "application/json" } : {},
      ...(hasBody ? { body: JSON.stringify(body ?? {}) } : {}),
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "网络连接失败，请检查连接后重试");
  }
  let payload: { data?: T; error?: { code: string; message: string } };
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(
      response.status,
      "INVALID_RESPONSE",
      "服务暂时不可用，请稍后重试",
    );
  }
  if (!response.ok)
    throw new ApiError(
      response.status,
      payload.error?.code || "REQUEST_FAILED",
      payload.error?.message || "请求失败，请重试",
    );
  if (!("data" in payload))
    throw new ApiError(response.status, "INVALID_RESPONSE", "服务返回格式异常");
  return payload.data as T;
}
