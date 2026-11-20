import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import ShareBookDialog from "../components/ShareBookDialog.vue";
import type { BookShare } from "../api";

const baseShare: BookShare = {
  id: "s1",
  userId: "u2",
  name: "家人小满",
  phone: "13900000002",
  status: "pending",
  createdAt: "2026-11-16T00:00:00.000Z",
};
let wrapper: VueWrapper | undefined;
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});
function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), { status });
}
function mountDialog() {
  wrapper = mount(ShareBookDialog, {
    props: { bookId: "b1", bookName: "小家的生活" },
    attachTo: document.body,
  });
  return wrapper;
}
describe("share book dialog", () => {
  it("lists recipients and shares with a registered phone number", async () => {
    let shares = [baseShare];
    const fetch = vi.fn(async (path: string, options: RequestInit) => {
      if (path !== "/api/books/b1/shares") throw new Error(path);
      if (options.method === "POST") {
        const body = JSON.parse(String(options.body));
        const added: BookShare = {
          id: "s3",
          userId: "u3",
          name: "新加入的家人",
          phone: body.phone,
          status: "pending",
          createdAt: "2026-11-17T00:00:00.000Z",
        };
        shares = [...shares, added];
        return reply(added, 201);
      }
      return reply({ ownerId: "u1", shares });
    });
    vi.stubGlobal("fetch", fetch);
    mountDialog();
    await flushPromises();
    expect(wrapper!.findAll(".share-row")).toHaveLength(1);
    expect(wrapper!.text()).toContain("家人小满");
    expect(wrapper!.text()).toContain("13900000002");
    await wrapper!.get('input[type="tel"]').setValue("13900000003");
    await wrapper!.get(".invite-form").trigger("submit");
    await flushPromises();
    const call = fetch.mock.calls.find((item) => item[1].method === "POST");
    expect(JSON.parse(String(call?.[1].body))).toEqual({ phone: "13900000003" });
    expect(wrapper!.text()).toContain("分享邀请已发送给 新加入的家人");
    expect(wrapper!.text()).toContain("待接受");
    expect(wrapper!.findAll(".share-row")).toHaveLength(2);
  });
  it("revokes a share only after inline confirmation", async () => {
    let shares = [baseShare];
    const fetch = vi.fn(async (path: string, options: RequestInit) => {
      if (options.method === "DELETE") {
        expect(path).toBe("/api/books/b1/shares/u2");
        shares = shares.filter((item) => item.userId !== "u2");
        return reply({ ok: true });
      }
      return reply({ ownerId: "u1", shares });
    });
    vi.stubGlobal("fetch", fetch);
    mountDialog();
    await flushPromises();
    const revoke = wrapper!
      .findAll("button")
      .find((button) => button.text() === "取消分享")!;
    await revoke.trigger("click");
    expect(wrapper!.text()).toContain("确定取消");
    expect(fetch.mock.calls.some((call) => call[1].method === "DELETE")).toBe(
      false,
    );
    await wrapper!
      .findAll("button")
      .find((button) => button.text() === "确定取消")!
      .trigger("click");
    await flushPromises();
    expect(shares).toEqual([]);
    expect(wrapper!.text()).toContain("已取消对 家人小满 的分享");
    expect(wrapper!.findAll(".share-row")).toHaveLength(0);
    expect(wrapper!.text()).toContain("还没有分享给任何人");
  });
  it("shows rejected status and lets the owner resend the invitation", async () => {
    let shares: BookShare[] = [{ ...baseShare, status: "rejected" }];
    const fetch = vi.fn(async (_path: string, options: RequestInit) => {
      if (options.method === "POST") {
        shares = [{ ...baseShare, status: "pending" }];
        return reply(shares[0], 200);
      }
      return reply({ ownerId: "u1", shares });
    });
    vi.stubGlobal("fetch", fetch);
    mountDialog();
    await flushPromises();
    expect(wrapper!.text()).toContain("已拒绝");
    await wrapper!
      .findAll("button")
      .find((button) => button.text() === "重新分享")!
      .trigger("click");
    await flushPromises();
    const call = fetch.mock.calls.find((item) => item[1].method === "POST");
    expect(JSON.parse(String(call?.[1].body))).toEqual({
      phone: "13900000002",
    });
    expect(wrapper!.text()).toContain("已重新发送给 家人小满");
    expect(wrapper!.text()).toContain("待接受");
  });
  it("surfaces server errors without losing the entered phone", async () => {
    const fetch = vi.fn(async (_path: string, options: RequestInit) =>
      options.method === "POST"
        ? new Response(
            JSON.stringify({
              error: {
                code: "USER_NOT_REGISTERED",
                message: "该手机号尚未注册，请对方先注册后再分享",
              },
            }),
            { status: 404 },
          )
        : reply({ ownerId: "u1", shares: [] }),
    );
    vi.stubGlobal("fetch", fetch);
    mountDialog();
    await flushPromises();
    await wrapper!.get('input[type="tel"]').setValue("13800000099");
    await wrapper!.get(".invite-form").trigger("submit");
    await flushPromises();
    expect(wrapper!.get('[role="alert"]').text()).toContain("尚未注册");
    expect(
      (wrapper!.get('input[type="tel"]').element as HTMLInputElement).value,
    ).toBe("13800000099");
  });
});