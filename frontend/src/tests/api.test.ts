import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "../api";
afterEach(() => vi.unstubAllGlobals());
describe("shared API transport", () => {
  it("includes session cookies and unwraps data", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: { id: "123" } })));
    vi.stubGlobal("fetch", fetch);
    expect(await api("/auth/me")).toEqual({ id: "123" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/me",
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );
  });
  it("sends integer cents exactly", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"data":{}}'));
    vi.stubGlobal("fetch", fetch);
    await api("/books/1/records", "POST", { amountCents: 29 });
    expect(fetch).toHaveBeenCalledWith(
      "/api/books/1/records",
      expect.objectContaining({
        headers: { "Content-Type": "application/json" },
        body: '{"amountCents":29}',
      }),
    );
  });
  it.each(["POST", "PATCH", "DELETE"])(
    "sends JSON for bodyless %s to satisfy CSRF protection",
    async (method) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response('{"data":{"ok":true}}'));
      vi.stubGlobal("fetch", fetch);
      await api("/auth/logout", method);
      expect(fetch).toHaveBeenCalledWith(
        "/api/auth/logout",
        expect.objectContaining({
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      );
    },
  );
  it("preserves Chinese service errors and status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"error":{"code":"UNAUTHORIZED","message":"请登录"}}', {
            status: 401,
          }),
        ),
    );
    await expect(api("/books")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
      message: "请登录",
    });
  });
  it("never fabricates data on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(api("/books")).rejects.toBeInstanceOf(ApiError);
  });
  it("rejects malformed responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
    await expect(api("/books")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});
