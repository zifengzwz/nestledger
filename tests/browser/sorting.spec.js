import { registerWithSms } from "./sms-fixture.mjs";
import { test, expect } from "@playwright/test";
import { randomInt } from "node:crypto";

test("账本支持拖拽、手机上下移动，账号顺序刷新后持久化", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin };
  const phone = `184${String(randomInt(100000000)).padStart(8, "0")}`;
  const password = "Book-Sort-2026!";
  const registered = await registerWithSms(page.request, {
    headers,
    data: { phone, password, name: "排序测试" },
  });
  expect(registered.status()).toBe(201);
  const created = [];
  try {
    for (let i = 1; i <= 3; i++) {
      const response = await page.request.post("/api/books", {
        headers,
        data: { name: `排序账本 ${i}`, type: i === 2 ? "family" : "personal" },
      });
      expect(response.status()).toBe(201);
      created.push((await response.json()).data);
    }
    const initial = (await (await page.request.get("/api/books")).json()).data;
    await page.reload();
    const choices = page.getByRole("listbox", {
      name: "当前账本",
      exact: true,
    });
    const initiallySelected = await choices
      .locator('[aria-selected="true"]')
      .getAttribute("title");
    await page
      .getByRole("button", { name: "调整账本顺序", exact: true })
      .click();
    const list = page.getByRole("list", { name: "调整账本顺序", exact: true });
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/books/order") &&
        response.request().method() === "PATCH",
    );
    await list
      .getByRole("listitem")
      .nth(0)
      .dragTo(list.getByRole("listitem").nth(1));
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const expected = [initial[1], initial[0], initial[2]];
    expect((await response.json()).data.map((book) => book.id)).toEqual(
      expected.map((book) => book.id),
    );
    await expect(list.getByRole("listitem").first()).toHaveAttribute(
      "title",
      expected[0].name,
    );
    await page
      .getByRole("button", { name: "完成账本排序", exact: true })
      .click();
    await expect(choices.locator('[aria-selected="true"]')).toHaveAttribute(
      "title",
      initiallySelected,
    );
    await page.reload();
    await expect(choices.getByRole("option").first()).toHaveAttribute(
      "title",
      `${expected[0].name} · ${expected[0].type === "family" ? "家庭" : "个人"}`,
    );

    // A fresh login on another touch-enabled device reads the account preference.
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      reducedMotion: "reduce",
    });
    try {
      const mobile = await context.newPage();
      const login = await mobile.request.post("/api/auth/login", {
        headers,
        data: { phone, password },
      });
      expect(login.status()).toBe(200);
      await mobile.goto("/");
      await mobile.getByRole("button", { name: "打开导航", exact: true }).tap();
      const mobileChoices = mobile.getByRole("listbox", {
        name: "当前账本",
        exact: true,
      });
      await expect(mobileChoices.getByRole("option").first()).toContainText(
        expected[0].name,
      );
      await mobile
        .getByRole("button", { name: "调整账本顺序", exact: true })
        .tap();
      const saved = mobile.waitForResponse(
        (response) =>
          response.url().endsWith("/api/books/order") &&
          response.request().method() === "PATCH",
      );
      await mobile
        .getByRole("button", { name: `上移${expected[1].name}`, exact: true })
        .tap();
      expect((await saved).status()).toBe(200);
      await mobile
        .getByRole("button", { name: "完成账本排序", exact: true })
        .tap();
      await expect(mobileChoices.getByRole("option").first()).toContainText(
        expected[1].name,
      );
      await mobile.reload();
      await mobile.getByRole("button", { name: "打开导航", exact: true }).tap();
      await expect(mobileChoices.getByRole("option").first()).toContainText(
        expected[1].name,
      );
    } finally {
      await context.close();
    }
    // The desktop sees the same persisted order after reloading, not a localStorage-only order.
    await page.reload();
    await expect(choices.getByRole("option").first()).toContainText(
      expected[1].name,
    );
  } finally {
    for (const book of created) {
      const deleted = await page.request.delete(`/api/books/${book.id}`, {
        headers,
        data: {},
      });
      expect(deleted.status()).toBe(200);
    }
  }
});
