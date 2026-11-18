import { registerWithSms } from "./sms-fixture.mjs";
import { test, expect } from "@playwright/test";
import { randomInt } from "node:crypto";

test("左侧最多显示五本，七本账本可滚动、切换和在手机访问", async ({ page }) => {
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin };
  const registered = await registerWithSms(page.request, {
    headers,
    data: {
      phone: `183${String(randomInt(100000000)).padStart(8, "0")}`,
      password: "Sidebar-Books-2026!",
      name: "五行账本测试",
    },
  });
  expect(registered.status()).toBe(201);
  const books = [];
  try {
    for (let i = 1; i <= 7; i++) {
      const response = await page.request.post("/api/books", {
        headers,
        data: { name: `侧栏账本 ${i}`, type: i % 2 ? "personal" : "family" },
      });
      expect(response.status()).toBe(201);
      books.push((await response.json()).data);
    }
    await page.reload();
    const list = page.getByRole("listbox", { name: "当前账本", exact: true });
    await expect(list.getByRole("option")).toHaveCount(7);
    await expect(
      page.getByText("最多显示 5 本，滚动查看更多", { exact: true }),
    ).toBeVisible();
    const measure = async () =>
      list.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const options = [...element.querySelectorAll('[role="option"]')];
        return {
          height: element.clientHeight,
          row: options[0].getBoundingClientRect().height,
          scrollable: element.scrollHeight > element.clientHeight,
          fullyVisible: options.filter((option) => {
            const box = option.getBoundingClientRect();
            return (
              box.top >= bounds.top - 0.5 && box.bottom <= bounds.bottom + 0.5
            );
          }).length,
        };
      });
    let size = await measure();
    expect(size.scrollable).toBeTruthy();
    expect(size.height).toBeCloseTo(size.row * 5, 0);
    expect(size.fullyVisible).toBe(5);
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const last = list.getByRole("option").last();
    const name = (await last.getAttribute("title")).split(" · ")[0];
    const chosen = books.find((book) => book.name === name);
    const recordsLoaded = page.waitForResponse((response) =>
      response.url().includes(`/api/books/${chosen.id}/records?`),
    );
    await last.click();
    expect((await recordsLoaded).status()).toBe(200);
    await expect(last).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".page-heading p")).toContainText(name);
    size = await measure();
    expect(size.fullyVisible).toBe(5);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "打开导航", exact: true }).click();
    await expect(list).toBeVisible();
    expect((await measure()).fullyVisible).toBe(5);
    await list.getByRole("option").last().focus();
    await list.getByRole("option").last().press("Home");
    await expect(list.getByRole("option").first()).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("button", { name: "关闭导航", exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  } finally {
    for (const book of books) {
      const response = await page.request.delete(`/api/books/${book.id}`, {
        headers,
        data: {},
      });
      expect(response.status()).toBe(200);
    }
  }
});
