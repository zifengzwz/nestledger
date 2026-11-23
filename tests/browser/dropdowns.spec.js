import { test, expect } from "@playwright/test";
import { randomInt } from "node:crypto";
import { smsCode } from "./sms-fixture.mjs";

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test.describe(`${viewport.width}px dropdown`, () => {
    test.use({ viewport, hasTouch: viewport.width === 390 });
    test(`记账分类与支付方式可展开、选择、手动输入和保存（${viewport.width}px）`, async ({
      page,
    }) => {
      const activate = viewport.width === 390 ? "tap" : "click";
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page.getByRole("button", { name: "注册", exact: true })[activate]();
      await page.getByLabel("你的称呼").fill("下拉回归测试");
      const phone = `181${String(randomInt(100000000)).padStart(8, "0")}`;
      await page.getByLabel("手机号", { exact: true }).fill(phone);
      await page.getByLabel("短信验证码").fill(smsCode(phone));
      await page
        .getByLabel("密码", { exact: true })
        .fill("Dropdown-Test-2026!");
      await page.getByLabel("确认密码", { exact: true }).fill("Dropdown-Test-2026!");
      await page.getByRole("button", { name: "注册并开启记账" })[activate]();
      await page
        .getByRole("button", { name: "创建我的第一本账本" })
        [activate]();
      let modal = page.getByRole("dialog");
      await modal.getByLabel("账本名称").fill("下拉选择验证");
      await modal
        .getByRole("button", { name: "创建账本", exact: true })
        [activate]();
      await expect(modal).toBeHidden();
      await page
        .getByRole("button", { name: "记一笔", exact: true })
        [activate]();
      modal = page.getByRole("dialog");
      await modal.getByLabel("金额（元）", { exact: true }).fill("12.50");
      await modal.getByRole("button", { name: "展开大分类选项" })[activate]();
      await expect(
        modal.getByRole("listbox", { name: "大分类选项" }).getByRole("option"),
      ).toHaveCount(10);
      await expect(
        modal
          .getByRole("option", { name: "餐饮美食", exact: true })
          .locator('[data-option-icon="utensils"]'),
      ).toBeVisible();
      await expect(
        modal
          .getByRole("option", { name: "交通出行", exact: true })
          .locator('[data-option-icon="bus-front"]'),
      ).toBeVisible();
      await modal
        .getByRole("option", { name: "交通出行", exact: true })
        [activate]();
      await expect(
        modal.getByRole("combobox", { name: "大分类", exact: true }),
      ).toHaveValue("交通出行");
      await modal.getByRole("button", { name: "展开支付方式选项" })[activate]();
      await expect(
        modal
          .getByRole("listbox", { name: "支付方式选项" })
          .getByRole("option"),
      ).toHaveCount(5);
      await modal
        .getByRole("option", { name: "现金", exact: true })
        [activate]();
      await expect(
        modal.getByRole("combobox", { name: "支付方式", exact: true }),
      ).toHaveValue("现金");
      await expect(
        modal.locator('.select-current-icon[data-option-icon="banknote"]'),
      ).toBeVisible();
      await expect(
        modal.locator('.select-current-icon[data-option-icon="bus-front"]'),
      ).toBeVisible();
      await modal
        .getByRole("button", { name: "记好了", exact: true })
        [activate]();
      await expect(modal).toBeHidden();
      await expect(page.locator(".records-card tbody")).toContainText(
        "交通出行",
      );
      await expect(page.locator(".records-card tbody")).toContainText("现金");
      await expect(
        page.locator(
          '.records-card .record-icon [data-option-icon="bus-front"]',
        ),
      ).toBeVisible();
      await expect(
        page.locator(
          '.records-card .payment-tag [data-option-icon="banknote"]',
        ),
      ).toBeVisible();

      await page
        .getByRole("button", { name: "记一笔", exact: true })
        [activate]();
      await modal
        .getByRole("button", { name: "收入", exact: true })
        [activate]();
      await modal.getByRole("button", { name: "展开大分类选项" })[activate]();
      await expect(
        modal.getByRole("listbox", { name: "大分类选项" }).getByRole("option"),
      ).toHaveCount(6);
      await expect(
        modal.getByRole("option", { name: "交通出行", exact: true }),
      ).toHaveCount(0);
      await modal
        .getByRole("option", { name: "奖金收入", exact: true })
        [activate]();
      await modal
        .getByRole("combobox", { name: "支付方式", exact: true })
        .fill("家庭备用金");
      await modal.getByLabel("金额（元）", { exact: true }).fill("200.00");
      await modal
        .getByRole("button", { name: "记好了", exact: true })
        [activate]();
      await expect(modal).toBeHidden();
      await expect(page.locator(".records-card tbody")).toContainText(
        "奖金收入",
      );
      await expect(page.locator(".records-card tbody")).toContainText(
        "家庭备用金",
      );
      await expect(
        page.locator('.records-card .record-icon [data-option-icon="award"]'),
      ).toBeVisible();
      await expect(
        page.locator('.records-card .payment-tag [data-option-icon="wallet"]'),
      ).toBeVisible();

      // Editing a populated record must still offer every alternative, not just its current value.
      await page
        .getByRole("button", { name: "编辑奖金收入记录", exact: true })
        [activate]();
      await modal.getByRole("combobox", { name: "大分类", exact: true }).focus();
      await modal
        .getByRole("combobox", { name: "大分类", exact: true })
        .press("ArrowDown");
      await modal
        .getByRole("combobox", { name: "大分类", exact: true })
        .press("ArrowDown");
      await modal
        .getByRole("combobox", { name: "大分类", exact: true })
        .press("Enter");
      await expect(modal).toBeVisible();
      await modal.getByRole("button", { name: "展开支付方式选项" })[activate]();
      await expect(
        modal
          .getByRole("listbox", { name: "支付方式选项" })
          .getByRole("option"),
      ).toHaveCount(5);
      await modal
        .getByRole("combobox", { name: "支付方式", exact: true })
        .press("Escape");
      await expect(modal.getByRole("listbox")).toHaveCount(0);
      await expect(modal).toBeVisible();
      await modal
        .getByRole("button", { name: "取消", exact: true })
        [activate]();
    });
  });
}
