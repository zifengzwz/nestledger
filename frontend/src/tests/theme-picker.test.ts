import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import ThemePicker from "../components/ThemePicker.vue";
import { THEMES } from "../theme";

let wrapper: ReturnType<typeof mount> | undefined;
function setup(disabled = false) {
  wrapper = mount(ThemePicker, {
    props: { modelValue: "clay" as const, disabled },
    attachTo: document.body,
  });
  return wrapper;
}
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ""; });

describe("theme picker", () => {
  it("renders one accessible radio per theme with the current one checked", () => {
    const field = setup();
    const radios = field.findAll('[role="radio"]');
    expect(radios).toHaveLength(THEMES.length);
    expect(field.get('[role="radiogroup"]').attributes("aria-label")).toBe("界面色调");
    expect(field.findAll('[aria-checked="true"]')).toHaveLength(1);
    expect(field.get('[aria-checked="true"]').attributes("data-theme-choice")).toBe("clay");
    expect(field.text()).toContain("陶土暖棕");
    expect(field.text()).toContain("森林青绿");
  });
  it("emits the chosen theme and ignores re-picking the active one", async () => {
    const field = setup();
    await field.get('[data-theme-choice="forest"]').trigger("click");
    expect(field.emitted("update:modelValue")?.at(-1)).toEqual(["forest"]);
    await field.get('[data-theme-choice="clay"]').trigger("click");
    expect(field.emitted("update:modelValue")).toHaveLength(1);
    await field.setProps({ modelValue: "forest" });
    expect(field.get('[aria-checked="true"]').attributes("data-theme-choice")).toBe("forest");
  });
  it("is disabled while saving", async () => {
    const field = setup(true);
    await field.get('[data-theme-choice="blue"]').trigger("click");
    expect(field.emitted("update:modelValue")).toBeUndefined();
    expect(field.get('[data-theme-choice="blue"]').attributes("disabled")).toBeDefined();
  });
  it("supports arrow, Home and End keys with roving focus", async () => {
    const field = setup();
    const first = field.get('[data-theme-choice="clay"]');
    expect(first.attributes("tabindex")).toBe("0");
    expect(field.get('[data-theme-choice="forest"]').attributes("tabindex")).toBe("-1");
    await first.trigger("keydown", { key: "ArrowRight" });
    expect(field.emitted("update:modelValue")?.at(-1)).toEqual(["forest"]);
    expect(document.activeElement).toBe(field.get('[data-theme-choice="forest"]').element);
    await first.trigger("keydown", { key: "End" });
    expect(field.emitted("update:modelValue")?.at(-1)).toEqual(["contrast-wine"]);
    const before = field.emitted("update:modelValue")!.length;
    await first.trigger("keydown", { key: "Home" });
    // Already on the first option: focus returns home without a duplicate emit.
    expect(field.emitted("update:modelValue")).toHaveLength(before);
    expect(document.activeElement).toBe(field.get('[data-theme-choice="clay"]').element);
    await first.trigger("keydown", { key: "ArrowLeft" });
    expect(field.emitted("update:modelValue")?.at(-1)).toEqual(["contrast-wine"]);
  });
});
