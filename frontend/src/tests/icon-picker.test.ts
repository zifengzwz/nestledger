import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import IconPicker from "../components/IconPicker.vue";
import { iconChoices } from "../optionIcons";
let wrapper: ReturnType<typeof mount> | undefined;
function setup() {
  wrapper = mount(IconPicker, {
    props: { modelValue: "tag" },
    attachTo: document.body,
  });
  return wrapper;
}
afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = "";
});
describe("custom option icon picker", () => {
  it("offers the 35 allowed local icons with labels and a checked default", () => {
    const field = setup();
    expect(iconChoices).toHaveLength(35);
    expect(new Set(iconChoices.map((icon) => icon.key)).size).toBe(35);
    expect(field.findAll('[role="radio"]')).toHaveLength(35);
    expect(field.get('[aria-checked="true"]').attributes("aria-label")).toBe(
      "图标：标签",
    );
    expect(
      field
        .findAll("button")
        .every((button) => button.attributes("type") === "button"),
    ).toBe(true);
  });
  it("selects a pet icon and updates the preview without submitting a form", async () => {
    const field = setup();
    await field.get('[aria-label="图标：宠物"]').trigger("click");
    expect(field.emitted("update:modelValue")?.at(-1)).toEqual(["paw-print"]);
    await field.setProps({ modelValue: "paw-print" });
    expect(
      field.get('[aria-checked="true"]').attributes("data-picker-icon"),
    ).toBe("paw-print");
    expect(field.get(".icon-picker-preview").text()).toContain("宠物");
  });
  it("supports arrows, Home and End with roving keyboard focus", async () => {
    const field = setup();
    const selected = field.get('[aria-checked="true"]');
    await selected.trigger("keydown", { key: "ArrowRight" });
    expect(field.emitted("update:modelValue")?.at(-1)).toEqual(["utensils"]);
    expect(document.activeElement).toBe(
      field.findAll('[role="radio"]')[1].element,
    );
    await selected.trigger("keydown", { key: "End" });
    expect(field.emitted("update:modelValue")?.at(-1)).toEqual(["wrench"]);
    await selected.trigger("keydown", { key: "Home" });
    expect(field.emitted("update:modelValue")?.at(-1)).toEqual(["tag"]);
  });
  it("does not change icons while saving", async () => {
    const field = setup();
    await field.setProps({ disabled: true });
    await field.get('[aria-label="图标：宠物"]').trigger("click");
    expect(field.emitted("update:modelValue")).toBeUndefined();
    expect(
      field.get('[aria-label="图标：宠物"]').attributes("disabled"),
    ).toBeDefined();
  });
});
