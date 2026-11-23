import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../App.vue";
const user = {
  id: "u1",
  phone: "13800000001",
  name: "小禾",
  createdAt: "2026-11-16T00:00:00Z",
};
const book = {
  id: "b1",
  name: "小家的生活",
  type: "family",
  ownerId: "u1",
  memberIds: ["u1"],
  createdAt: "2026-11-16T00:00:00Z",
};
const analysis = {
  period: "month",
  from: "2026-11-01T00:00:00Z",
  to: "2026-12-01T00:00:00Z",
  incomeCents: 0,
  expenseCents: 0,
  balanceCents: 0,
  recordCount: 0,
  trend: [],
  categories: [],
  members: [],
};
const recordOptions = {
  expenseCategories: [
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
  ],
  incomeCategories: [
    "工资薪酬",
    "奖金收入",
    "投资理财",
    "兼职收入",
    "礼金收入",
    "其他收入",
  ],
  paymentSources: ["微信", "支付宝", "银行卡", "现金", "其他"],
  expenseSubcategories: {
    餐饮美食: ["早餐", "午餐", "晚餐"],
    交通出行: ["地铁", "打车"],
  },
  incomeSubcategories: {
    工资薪酬: ["基本工资", "奖金"],
  },
};
let wrapper: VueWrapper | undefined;
function setup(authenticated = true) {
  const fetch = vi.fn(async (path: string, options: RequestInit) => {
    let data: unknown = { ok: true };
    if (path === "/api/auth/me" && !authenticated)
      return new Response(
        JSON.stringify({ error: { code: "UNAUTHORIZED", message: "请登录" } }),
        { status: 401 },
      );
    if (path === "/api/auth/me" || path === "/api/auth/login") data = user;
    else if (path === "/api/books") data = [book];
    else if (path === "/api/invitations") data = [];
    else if (path === "/api/shares") data = [];
    else if (path === "/api/record-options") data = recordOptions;
    else if (path.includes("/analysis?")) data = analysis;
    else if (path.includes("/records?"))
      data = { items: [], total: 0, page: 1, pageSize: 20 };
    return new Response(JSON.stringify({ data }));
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-theme");
  window.localStorage.clear();
});
describe("application integrated API flows", () => {
  it("sends login fields exactly according to shared contract", async () => {
    const fetch = setup(false);
    wrapper = mount(App);
    await flushPromises();
    await wrapper.get('input[type="tel"]').setValue("13800000001");
    await wrapper.get('input[type="password"]').setValue("password123");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    const call = fetch.mock.calls.find((call) => call[0] === "/api/auth/login");
    expect(JSON.parse(String(call?.[1].body))).toEqual({
      phone: "13800000001",
      password: "password123",
    });
    expect(wrapper.text()).toContain("小家的生活");
  });
  it("switches the active book and reloads its records and analysis from the sidebar list", async () => {
    const transport = setup();
    const base = transport.getMockImplementation()!;
    transport.mockImplementation(async (path, options) =>
      path === "/api/books"
        ? new Response(
            JSON.stringify({
              data: [
                book,
                { ...book, id: "b2", name: "我的日常", type: "personal" },
              ],
            }),
          )
        : base(path, options),
    );
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    const choices = wrapper.findAll('.book-list [role="option"]');
    expect(choices).toHaveLength(2);
    await choices[1].trigger("click");
    await flushPromises();
    expect(wrapper.get('.book-list [aria-selected="true"]').text()).toContain(
      "我的日常",
    );
    expect(
      transport.mock.calls.some((call) =>
        call[0].startsWith("/api/books/b2/records?"),
      ),
    ).toBe(true);
    expect(
      transport.mock.calls.some((call) =>
        call[0].startsWith("/api/books/b2/analysis?"),
      ),
    ).toBe(true);
    expect(
      wrapper.findAll("button").some((button) => button.text() === "邀请家人"),
    ).toBe(false);
  });
  it.each([false, true])(
    "saves book sorting or rolls back on failure (failure=$0)",
    async (fails) => {
      const transport = setup();
      const base = transport.getMockImplementation()!;
      const second = { ...book, id: "b2", name: "我的日常", type: "personal" };
      transport.mockImplementation(async (path, options) => {
        if (path === "/api/books")
          return new Response(JSON.stringify({ data: [book, second] }));
        if (path === "/api/books/order")
          return fails
            ? new Response(
                JSON.stringify({
                  error: { code: "SAVE_FAILED", message: "顺序保存失败" },
                }),
                { status: 500 },
              )
            : new Response(JSON.stringify({ data: [second, book] }));
        return base(path, options);
      });
      wrapper = mount(App, { attachTo: document.body });
      await flushPromises();
      await wrapper.get('[aria-label="调整账本顺序"]').trigger("click");
      await wrapper.get('[aria-label="下移小家的生活"]').trigger("click");
      await flushPromises();
      const call = transport.mock.calls.find(
        (call) => call[0] === "/api/books/order",
      );
      expect(call?.[1].method).toBe("PATCH");
      expect(JSON.parse(String(call?.[1].body))).toEqual({
        bookIds: ["b2", "b1"],
      });
      await wrapper.get('[aria-label="完成账本排序"]').trigger("click");
      const options = wrapper.findAll('.book-list [role="option"]');
      expect(options[0].text()).toContain(fails ? "小家的生活" : "我的日常");
      expect(wrapper.get('.book-list [aria-selected="true"]').text()).toContain(
        "小家的生活",
      );
      if (fails) expect(wrapper.text()).toContain("顺序保存失败");
    },
  );
  it("creates a real API record with exact integer cents and Shanghai timestamp", async () => {
    const fetch = setup();
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    const add = wrapper
      .findAll("button")
      .find((button) => button.text() === "记一笔");
    await add!.trigger("click");
    await wrapper.get('[aria-label="金额（元）"]').setValue("0.29");
    await wrapper
      .get('[role="dialog"] input[type="date"]')
      .setValue("2026-11-16");
    await wrapper.get('[role="dialog"] form').trigger("submit");
    await flushPromises();
    const call = fetch.mock.calls.find(
      (call) =>
        call[0] === "/api/books/b1/records" && call[1].method === "POST",
    );
    expect(JSON.parse(String(call?.[1].body))).toMatchObject({
      amountCents: 29,
      occurredAt: "2026-11-15T16:00:00.000Z",
      category: "餐饮美食",
      subcategory: "早餐",
      type: "expense",
    });
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });
  it("defaults a new record to the last recorded day, then to today", async () => {
    const transport = setup();
    const base = transport.getMockImplementation()!;
    const existing = {
      id: "r9",
      bookId: "b1",
      createdBy: "u1",
      type: "expense",
      amountCents: 100,
      category: "餐饮美食",
      subcategory: "早餐",
      occurredAt: "2026-11-16T04:00:00Z",
      note: "",
      paymentSource: "微信",
      createdAt: "2026-11-16T04:00:00Z",
      updatedAt: "2026-11-16T04:00:00Z",
    };
    transport.mockImplementation(async (path, init) =>
      path.startsWith("/api/books/b1/records?") && init.method === "GET"
        ? new Response(
            JSON.stringify({
              data: { items: [existing], total: 1, page: 1, pageSize: 20 },
            }),
          )
        : base(path, init),
    );
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "记一笔")!
      .trigger("click");
    await flushPromises();
    expect(
      (wrapper.get('[role="dialog"] input[type="date"]').element as HTMLInputElement)
        .value,
    ).toBe("2026-11-16");
    await wrapper
      .get('[role="dialog"] input[type="date"]')
      .setValue("2026-11-20");
    await wrapper.get('[aria-label="金额（元）"]').setValue("1.00");
    await wrapper.get('[role="dialog"] form').trigger("submit");
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "记一笔")!
      .trigger("click");
    await flushPromises();
    expect(
      (wrapper.get('[role="dialog"] input[type="date"]').element as HTMLInputElement)
        .value,
    ).toBe("2026-11-20");
  });
  it("records the selected subcategory under its major category", async () => {
    const transport = setup();
    const base = transport.getMockImplementation()!;
    transport.mockImplementation(async (path, init) =>
      path === "/api/books/b1/records" && init.method === "POST"
        ? new Response(JSON.stringify({ data: { ok: true } }), {
            status: 201,
          })
        : base(path, init),
    );
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "记一笔")!
      .trigger("click");
    await flushPromises();
    const subField = wrapper
      .findAll(".select-input-field")
      .find((field) => field.text().includes("小分类"))!;
    await subField.find('input[role="combobox"]').setValue("午餐");
    await wrapper.get('[aria-label="金额（元）"]').setValue("12.00");
    await wrapper.get('[role="dialog"] form').trigger("submit");
    await flushPromises();
    const call = transport.mock.calls.find(
      (item) =>
        item[0] === "/api/books/b1/records" && item[1].method === "POST",
    );
    expect(JSON.parse(String(call?.[1].body))).toMatchObject({
      category: "餐饮美食",
      subcategory: "午餐",
      amountCents: 1200,
    });
  });
  it("limits rapid-operation notifications to the newest three", async () => {
    const transport = setup();
    wrapper = mount(App);
    await flushPromises();
    await wrapper
      .findAll("nav button")
      .find((button) => button.text().includes("我的邀请"))!
      .trigger("click");
    await flushPromises();
    let count = 0;
    transport.mockImplementation(async (path) =>
      path === "/api/shares"
        ? new Response(JSON.stringify({ data: [] }))
        : new Response(
            JSON.stringify({
              error: { code: "SERVER_ERROR", message: `请求错误 ${++count}` },
            }),
            { status: 500 },
          ),
    );
    for (let i = 0; i < 5; i++) {
      await wrapper
        .findAll("button")
        .find((button) => button.text() === "刷新")!
        .trigger("click");
      await flushPromises();
    }
    const notifications = wrapper.findAll(".toast");
    expect(notifications).toHaveLength(3);
    expect(notifications.map((item) => item.text())).toEqual([
      "请求错误 3",
      "请求错误 4",
      "请求错误 5",
    ]);
  });
  it("keeps the session when current password is incorrect", async () => {
    const transport = setup();
    const base = transport.getMockImplementation()!;
    transport.mockImplementation(async (path, options) =>
      path === "/api/auth/password"
        ? new Response(
            JSON.stringify({
              error: { code: "INVALID_CREDENTIALS", message: "当前密码错误" },
            }),
            { status: 401 },
          )
        : base(path, options),
    );
    wrapper = mount(App);
    await flushPromises();
    await wrapper.get(".profile").trigger("click");
    await wrapper
      .findAll('input[type="password"]')[0]
      .setValue("wrongpassword");
    await wrapper
      .findAll('input[type="password"]')[1]
      .setValue("newpassword123");
    await wrapper.findAll("form")[0].trigger("submit");
    await flushPromises();
    expect(wrapper.find(".app-shell").exists()).toBe(true);
    expect(wrapper.text()).toContain("当前密码错误");
  });
  it("actually rejects an invitation after confirmation without nested busy suppression", async () => {
    const transport = setup();
    const base = transport.getMockImplementation()!;
    let pending = true;
    transport.mockImplementation(async (path, options) => {
      if (path === "/api/invitations/i1/reject") {
        pending = false;
        return new Response(JSON.stringify({ data: { ok: true } }));
      }
      if (path === "/api/invitations")
        return new Response(
          JSON.stringify({
            data: pending
              ? [
                  {
                    id: "i1",
                    bookId: "b2",
                    bookName: "另一个小家",
                    inviterName: "家人",
                    phone: user.phone,
                    status: "pending",
                    createdAt: user.createdAt,
                  },
                ]
              : [],
          }),
        );
      return base(path, options);
    });
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await wrapper
      .findAll("nav button")
      .find((button) => button.text().includes("我的邀请"))!
      .trigger("click");
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "拒绝")!
      .trigger("click");
    await wrapper
      .get('[role="dialog"] .modal-actions button:last-child')
      .trigger("click");
    await flushPromises();
    expect(
      transport.mock.calls.some(
        (call) => call[0] === "/api/invitations/i1/reject",
      ),
    ).toBe(true);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("暂时没有新邀请");
  });
  it("retains an explicit error state when API is offline, without demo data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    wrapper = mount(App);
    await flushPromises();
    expect(wrapper.text()).toContain("暂时无法连接小家");
    expect(wrapper.text()).toContain("重新连接");
    expect(wrapper.find(".stats-grid").exists()).toBe(false);
  });
  it.each([
    {
      type: "personal",
      ownerId: user.id,
      canInvite: false,
      hint: "不支持邀请成员",
    },
    {
      type: "family",
      ownerId: user.id,
      canInvite: true,
      hint: "你是家庭账本拥有者",
    },
    {
      type: "family",
      ownerId: "other-owner",
      canInvite: false,
      hint: "只有家庭账本拥有者可以邀请新成员",
    },
  ])(
    "shows invitations correctly for $type / $ownerId",
    async ({ type, ownerId, canInvite, hint }) => {
      const transport = setup();
      const base = transport.getMockImplementation()!;
      transport.mockImplementation(async (path, options) => {
        if (path === "/api/books")
          return new Response(
            JSON.stringify({ data: [{ ...book, type, ownerId }] }),
          );
        if (path.endsWith("/members"))
          return new Response(
            JSON.stringify({ data: { ownerId, members: [user] } }),
          );
        return base(path, options);
      });
      wrapper = mount(App, { attachTo: document.body });
      await flushPromises();
      const shortcut = wrapper
        .findAll("button")
        .find((button) => button.text() === "邀请家人");
      expect(Boolean(shortcut)).toBe(canInvite);
      if (shortcut) await shortcut.trigger("click");
      else
        await wrapper
          .findAll("nav button")
          .find((button) => button.text() === "账本管理")!
          .trigger("click");
      await flushPromises();
      expect(wrapper.find(".invite-form").exists()).toBe(canInvite);
      expect(wrapper.text()).toContain(hint);
      expect(wrapper.text()).not.toContain(
        "仅拥有者可以更名、删除账本及邀请成员。",
      );
      if (canInvite)
        expect(document.activeElement).toBe(
          wrapper.get(".invite-form input").element,
        );
      await wrapper
        .findAll("nav button")
        .find((button) => button.text() === "我的邀请")!
        .trigger("click");
      await flushPromises();
      expect(wrapper.text()).toContain("与左侧选择的账本无关");
    },
  );
  it("shows an inline error for an unregistered invitee and preserves their phone", async () => {
    const transport = setup();
    const base = transport.getMockImplementation()!;
    transport.mockImplementation(async (path, options) =>
      path === "/api/books/b1/invitations"
        ? new Response(
            JSON.stringify({
              error: {
                code: "USER_NOT_REGISTERED",
                message: "该手机号尚未注册，请对方先注册后再邀请",
              },
            }),
            { status: 404 },
          )
        : base(path, options),
    );
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "邀请家人")!
      .trigger("click");
    await flushPromises();
    await wrapper.get(".invite-form input").setValue("13800000099");
    await wrapper.get(".invite-form").trigger("submit");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("尚未注册");
    expect(
      (wrapper.get(".invite-form input").element as HTMLInputElement).value,
    ).toBe("13800000099");
    expect(wrapper.find(".app-shell").exists()).toBe(true);
    await wrapper.get(".invite-form input").setValue("13800000098");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
  it("shows the platform-only invitation notice and owner controls", async () => {
    setup();
    wrapper = mount(App);
    await flushPromises();
    await wrapper
      .findAll("nav button")
      .find((button) => button.text().includes("账本管理"))!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("不会发送短信");
    expect(wrapper.text()).toContain("已注册小家有账的手机号");
    expect(wrapper.text()).toContain("未注册的号码请先注册后再邀请");
    expect(wrapper.text()).toContain("删除账本");
    expect(wrapper.find('input[type="tel"]').exists()).toBe(true);
  });

  it("shows who recorded family records and filters overview, records and analysis by member", async () => {
    const transport = setup();
    const base = transport.getMockImplementation()!;
    const family = { ...book, memberIds: ["u1", "u2"] };
    const authors = [
      { id: "u1", name: "小禾" },
      { id: "u2", name: "阿木" },
    ];
    const makeRecord = (
      id: string,
      createdBy: string,
      createdByName: string,
      category: string,
      note: string,
    ) => ({
      id,
      bookId: "b1",
      createdBy,
      createdByName,
      type: "expense",
      amountCents: 100,
      category,
      occurredAt: "2026-11-16T04:00:00Z",
      note,
      paymentSource: "微信",
      createdAt: "2026-11-16T04:00:00Z",
      updatedAt: "2026-11-16T04:00:00Z",
    });
    const rows = [
      makeRecord("r1", "u1", "小禾", "早餐", "小禾的早餐"),
      makeRecord("r2", "u2", "阿木", "午餐", "阿木的午餐"),
    ];
    const memberAnalysis = {
      ...analysis,
      members: [
        {
          userId: "u1",
          name: "小禾",
          incomeCents: 1000,
          expenseCents: 2000,
          balanceCents: -1000,
          recordCount: 1,
        },
        {
          userId: "u2",
          name: "阿木",
          incomeCents: 0,
          expenseCents: 100,
          balanceCents: -100,
          recordCount: 1,
        },
      ],
    };
    transport.mockImplementation(async (path, options) => {
      if (path === "/api/books")
        return new Response(JSON.stringify({ data: [family] }));
      if (path.startsWith("/api/books/b1/records?")) {
        const url = new URL("http://local" + path);
        const createdBy = url.searchParams.get("createdBy");
        const items = createdBy
          ? rows.filter((row) => row.createdBy === createdBy)
          : rows;
        return new Response(
          JSON.stringify({
            data: { items, total: items.length, page: 1, pageSize: 20, authors },
          }),
        );
      }
      if (path.startsWith("/api/books/b1/analysis?"))
        return new Response(JSON.stringify({ data: memberAnalysis }));
      return base(path, options);
    });
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.text()).toContain("记录人");
    expect(wrapper.text()).toContain("小禾的早餐");
    expect(wrapper.text()).toContain("阿木的午餐");
    expect(
      wrapper.findAll("td").some((cell) => cell.text() === "我"),
    ).toBe(true);
    const select = wrapper.get('select[aria-label="按记录人筛选"]');
    expect(select.findAll("option").map((option) => option.text())).toEqual([
      "全部成员",
      "我",
      "阿木",
    ]);
    await select.setValue("u2");
    await flushPromises();
    expect(
      transport.mock.calls.some(
        (call) =>
          call[0].startsWith("/api/books/b1/records?") &&
          call[0].includes("createdBy=u2"),
      ),
    ).toBe(true);
    expect(
      transport.mock.calls.some(
        (call) =>
          call[0].includes("/api/books/b1/analysis?") &&
          call[0].includes("member=u2"),
      ),
    ).toBe(true);
    expect(wrapper.text()).toContain("阿木的午餐");
    expect(wrapper.text()).not.toContain("小禾的早餐");
    await wrapper
      .findAll("nav button")
      .find((button) => button.text().includes("收支分析"))!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("成员收支");
    const memberTable = wrapper.get(".member-table");
    expect(memberTable.text()).toContain("我");
    expect(memberTable.text()).toContain("阿木");
    expect(memberTable.text()).not.toContain("小禾");
    expect(
      wrapper.findAll("button").some((button) => button.text() === "查看全部"),
    ).toBe(true);
  });
  it("switches the analysis to all books using only the current user's records", async () => {
    const transport = setup();
    const base = transport.getMockImplementation()!;
    const allAnalysis = {
      ...analysis,
      expenseCents: 300,
      balanceCents: -300,
      recordCount: 2,
      books: [
        {
          bookId: "b1",
          name: "小家的生活",
          incomeCents: 0,
          expenseCents: 200,
          balanceCents: -200,
          recordCount: 1,
        },
        {
          bookId: "b2",
          name: "我的日常",
          incomeCents: 0,
          expenseCents: 100,
          balanceCents: -100,
          recordCount: 1,
        },
      ],
    };
    transport.mockImplementation(async (path, options) =>
      path.startsWith("/api/analysis?")
        ? new Response(JSON.stringify({ data: allAnalysis }))
        : base(path, options),
    );
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await wrapper
      .findAll("nav button")
      .find((button) => button.text().includes("收支分析"))!
      .trigger("click");
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "全部账本")!
      .trigger("click");
    await flushPromises();
    expect(
      transport.mock.calls.some((call) => call[0].startsWith("/api/analysis?")),
    ).toBe(true);
    expect(wrapper.text()).toContain("各账本汇总");
    expect(wrapper.text()).toContain("小家的生活");
    expect(wrapper.text()).toContain("我的日常");
    expect(wrapper.text()).not.toContain("成员收支");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "当前账本")!
      .trigger("click");
    await flushPromises();
    expect(
      transport.mock.calls.filter((call) =>
        call[0].startsWith("/api/books/b1/analysis?"),
      ).length,
    ).toBeGreaterThan(1);
  });
  it("opens the share dialog for the owner and shows recipients", async () => {
    const transport = setup();
    const base = transport.getMockImplementation()!;
    transport.mockImplementation(async (path, options) =>
      path === "/api/books/b1/shares"
        ? new Response(
            JSON.stringify({ data: { ownerId: "u1", shares: [] } }),
          )
        : base(path, options),
    );
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("分享账本"))!
      .trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("分享账本给指定用户");
    expect(wrapper.text()).toContain("已分享的用户");
    expect(wrapper.text()).toContain("还没有分享给任何人");
  });
  it("renders a book shared to this account as read-only", async () => {
    const transport = setup();
    const base = transport.getMockImplementation()!;
    const shared = {
      ...book,
      id: "shared-1",
      name: "家人分享的账本",
      ownerId: "u2",
      memberIds: ["u2"],
      readOnly: true,
      ownerName: "小满",
      ownerPhone: "13900000002",
    };
    transport.mockImplementation(async (path, options) =>
      path === "/api/books"
        ? new Response(JSON.stringify({ data: [shared] }))
        : base(path, options),
    );
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.get(".book-kind").text()).toBe("只读");
    expect(wrapper.text()).toContain("来自 13900000002 的只读账本");
    expect(wrapper.text()).toContain("只读账本");
    expect(wrapper.text()).toContain("13900000002");
    expect(wrapper.get(".book-owner").text()).toContain("13900000002");
    for (const label of ["记一笔", "导出账本", "导入账本", "分享账本", "邀请家人"])
      expect(
        wrapper.findAll("button").some((button) => button.text().includes(label)),
      ).toBe(false);
    expect(
      transport.mock.calls.some((call) => call[0].includes("/records?")),
    ).toBe(true);
    await wrapper
      .findAll("nav button")
      .find((button) => button.text().includes("账本管理"))!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("只读访客");
    expect(wrapper.text()).toContain("账本拥有者可以随时取消分享");
    expect(
      transport.mock.calls.some(
        (call) => call[0] === "/api/books/shared-1/members",
      ),
    ).toBe(false);
  });
  it("accepts a pending read-only share and opens the shared book", async () => {
    const transport = setup();
    const base = transport.getMockImplementation()!;
    const share = {
      id: "s1",
      bookId: "shared-1",
      bookName: "共享的账本",
      ownerName: "小满",
      ownerPhone: "13900000002",
      createdAt: "2026-11-16T00:00:00Z",
    };
    const sharedBook = {
      ...book,
      id: "shared-1",
      name: "共享的账本",
      ownerId: "u2",
      memberIds: ["u2"],
      readOnly: true,
      ownerName: "小满",
      ownerPhone: "13900000002",
    };
    let accepted = false;
    transport.mockImplementation(async (path, options) => {
      if (path === "/api/shares")
        return new Response(
          JSON.stringify({ data: accepted ? [] : [share] }),
        );
      if (path === "/api/shares/s1/accept") {
        accepted = true;
        return new Response(JSON.stringify({ data: sharedBook }));
      }
      if (path === "/api/books")
        return new Response(
          JSON.stringify({ data: accepted ? [sharedBook] : [] }),
        );
      return base(path, options);
    });
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await wrapper
      .findAll("nav button")
      .find((button) => button.text().includes("我的邀请"))!
      .trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("分享给我的账本");
    expect(wrapper.text()).toContain("13900000002");
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("接受分享"))!
      .trigger("click");
    await flushPromises();
    expect(
      transport.mock.calls.some((call) => call[0] === "/api/shares/s1/accept"),
    ).toBe(true);
    expect(wrapper.text()).toContain("共享的账本");
    expect(wrapper.text()).toContain("来自 13900000002 的只读账本");
    expect(wrapper.text()).toContain("已接受只读分享");
  });
  it("rejects a pending read-only share after confirmation", async () => {
    const transport = setup();
    const base = transport.getMockImplementation()!;
    const share = {
      id: "s2",
      bookId: "shared-2",
      bookName: "待拒绝的账本",
      ownerName: "小满",
      ownerPhone: "13900000003",
      createdAt: "2026-11-16T00:00:00Z",
    };
    let shares = [share];
    transport.mockImplementation(async (path, options) => {
      if (path === "/api/shares")
        return new Response(JSON.stringify({ data: shares }));
      if (path === "/api/shares/s2/reject") {
        shares = [];
        return new Response(JSON.stringify({ data: { ok: true } }));
      }
      return base(path, options);
    });
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await wrapper
      .findAll("nav button")
      .find((button) => button.text().includes("我的邀请"))!
      .trigger("click");
    await flushPromises();
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "拒绝")!
      .trigger("click");
    await wrapper
      .get('[role="dialog"] .modal-actions button:last-child')
      .trigger("click");
    await flushPromises();
    expect(
      transport.mock.calls.some((call) => call[0] === "/api/shares/s2/reject"),
    ).toBe(true);
    expect(wrapper.text()).toContain("已拒绝分享");
    expect(wrapper.text()).not.toContain("待拒绝的账本");
  });
  it("applies the account theme and saves a newly chosen one", async () => {
    const transport = setup();
    const base = transport.getMockImplementation()!;
    transport.mockImplementation(async (path, options) => {
      if (path === "/api/auth/me") return new Response(JSON.stringify({ data: { ...user, theme: "forest" } }));
      if (path === "/api/auth/settings" && options.method === "PATCH")
        return new Response(JSON.stringify({ data: { ...user, theme: JSON.parse(String(options.body)).theme } }));
      return base(path, options);
    });
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    expect(document.documentElement.dataset.theme).toBe("forest");
    expect(window.localStorage.getItem("nestledger.theme")).toBe("forest");

    await wrapper.find(".profile").trigger("click");
    await flushPromises();
    const picker = wrapper.get('[role="radiogroup"][aria-label="界面色调"]');
    expect(picker.findAll('[role="radio"]')).toHaveLength(11);
    await wrapper.get('[data-theme-choice="plum"]').trigger("click");
    await flushPromises();
    expect(document.documentElement.dataset.theme).toBe("plum");
    expect(window.localStorage.getItem("nestledger.theme")).toBe("plum");
    const call = transport.mock.calls.find(call => call[0] === "/api/auth/settings");
    expect(call?.[1].method).toBe("PATCH");
    expect(JSON.parse(String(call?.[1].body))).toEqual({ theme: "plum" });
    expect(wrapper.text()).toContain("界面色调已保存到账号");
  });
  it("reverts the visual theme when the account sync fails", async () => {
    const transport = setup();
    const base = transport.getMockImplementation()!;
    transport.mockImplementation(async (path, options) => path === "/api/auth/settings"
      ? new Response(JSON.stringify({ error: { code: "SERVER_ERROR", message: "同步暂时失败" } }), { status: 500 })
      : base(path, options));
    wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await wrapper.find(".profile").trigger("click");
    await flushPromises();
    const before = document.documentElement.dataset.theme;
    await wrapper.get('[data-theme-choice="blue"]').trigger("click");
    await flushPromises();
    expect(document.documentElement.dataset.theme).toBe(before);
    expect(wrapper.text()).toContain("未能同步到账号");
    expect(wrapper.find(".app-shell").exists()).toBe(true);
  });
});
