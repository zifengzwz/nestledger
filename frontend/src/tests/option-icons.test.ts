import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { optionIcon } from "../optionIcons";
import OptionIcon from "../components/OptionIcon.vue";

describe("category and payment icons", () => {
  it("assigns meaningful icons to every default expense category", () => {
    const examples = {
      餐饮美食: "utensils",
      日用百货: "shopping-basket",
      交通出行: "bus-front",
      住房物业: "house",
      购物消费: "shopping-bag",
      休闲娱乐: "gamepad",
      医疗健康: "heart-pulse",
      教育学习: "graduation-cap",
      人情往来: "gift",
      其他支出: "circle-ellipsis",
    };
    for (const [name, key] of Object.entries(examples))
      expect(optionIcon("expense", name).key).toBe(key);
  });
  it("assigns distinct income icons and does not mix category types", () => {
    const examples = {
      工资薪酬: "briefcase-business",
      奖金收入: "award",
      投资理财: "chart",
      兼职收入: "laptop",
      礼金收入: "gift",
      其他收入: "coins",
    };
    for (const [name, key] of Object.entries(examples))
      expect(optionIcon("income", name).key).toBe(key);
    expect(optionIcon("income", "餐饮美食").key).toBe("coins");
  });
  it("provides icons and restrained colors for each built-in payment method", () => {
    const examples = {
      微信: "message-circle",
      支付宝: "qr-code",
      银行卡: "credit-card",
      现金: "banknote",
      其他: "wallet",
    };
    for (const [name, key] of Object.entries(examples)) {
      expect(optionIcon("payment", name).key).toBe(key);
      expect(optionIcon("payment", name).color).toMatch(/^#[a-f0-9]{6}$/i);
    }
  });
  it("supports older short labels without changing record data", () => {
    expect(optionIcon("expense", "餐饮").key).toBe("utensils");
    expect(optionIcon("income", "工资").key).toBe("briefcase-business");
    expect(optionIcon("payment", " 微信支付 ").key).toBe("message-circle");
  });
  it("uses safe fallbacks for custom, empty and prototype-like names", () => {
    for (const name of [
      "自定义内容",
      "",
      "constructor",
      "__proto__",
      "toString",
    ]) {
      expect(optionIcon("expense", name).key).toBe("tag");
      expect(optionIcon("income", name).key).toBe("coins");
      expect(optionIcon("payment", name).key).toBe("wallet");
    }
  });
  it("renders a saved icon choice and safely falls back for an unknown ID", async () => {
    const wrapper = mount(OptionIcon, {
      props: { kind: "expense", name: "宠物开销", icon: "paw-print" },
    });
    expect(wrapper.get("svg").attributes("data-option-icon")).toBe("paw-print");
    await wrapper.setProps({ icon: "https://untrusted.example/image.svg" });
    expect(wrapper.get("svg").attributes("data-option-icon")).toBe("tag");
    await wrapper.setProps({ icon: "__proto__" });
    expect(wrapper.get("svg").attributes("data-option-icon")).toBe("tag");
    wrapper.unmount();
  });
  it("renders local SVG icons decoratively and updates when the option changes", async () => {
    const wrapper = mount(OptionIcon, {
      props: { kind: "payment", name: "微信", size: 14 },
    });
    expect(wrapper.get("svg").attributes("data-option-icon")).toBe(
      "message-circle",
    );
    expect(wrapper.get("svg").attributes("aria-hidden")).toBe("true");
    expect(wrapper.get("svg").attributes("focusable")).toBe("false");
    expect(wrapper.get("svg").attributes("width")).toBe("14");
    await wrapper.setProps({ name: "现金" });
    expect(wrapper.get("svg").attributes("data-option-icon")).toBe("banknote");
    wrapper.unmount();
  });
});
