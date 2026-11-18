<script setup lang="ts">
import { computed, ref } from "vue";
import { iconChoices } from "../optionIcons";
import OptionIcon from "./OptionIcon.vue";
const props = withDefaults(
  defineProps<{ modelValue: string; disabled?: boolean }>(),
  { disabled: false },
);
const emit = defineEmits<{ "update:modelValue": [icon: string] }>();
const grid = ref<HTMLElement>();
const selected = computed(
  () =>
    iconChoices.find((icon) => icon.key === props.modelValue) ?? iconChoices[0],
);
function choose(key: string) {
  if (!props.disabled) emit("update:modelValue", key);
}
function keyboard(event: KeyboardEvent, index: number) {
  if (props.disabled) return;
  const steps: Record<string, number> = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: 6,
    ArrowUp: -6,
  };
  let target: number;
  if (event.key === "Home") target = 0;
  else if (event.key === "End") target = iconChoices.length - 1;
  else if (Object.prototype.hasOwnProperty.call(steps, event.key))
    target =
      (index + steps[event.key] + iconChoices.length) % iconChoices.length;
  else return;
  event.preventDefault();
  choose(iconChoices[target].key);
  const button =
    grid.value?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[target];
  button?.focus({ preventScroll: true });
  button?.scrollIntoView?.({ block: "nearest" });
}
</script>

<template>
  <fieldset class="icon-picker" :disabled="disabled">
    <legend>选择图标</legend>
    <div class="icon-picker-preview">
      <OptionIcon
        kind="expense"
        :name="selected.label"
        :icon="selected.key"
        :size="18"
      /><span>当前：{{ selected.label }}</span>
    </div>
    <div
      ref="grid"
      class="icon-picker-grid"
      role="radiogroup"
      aria-label="选择图标"
    >
      <button
        v-for="(icon, index) in iconChoices"
        :key="icon.key"
        type="button"
        role="radio"
        class="icon-choice"
        :aria-label="`图标：${icon.label}`"
        :aria-checked="modelValue === icon.key"
        :tabindex="
          modelValue === icon.key ||
          (!iconChoices.some((choice) => choice.key === modelValue) &&
            index === 0)
            ? 0
            : -1
        "
        :title="icon.label"
        :disabled="disabled"
        :data-picker-icon="icon.key"
        @click="choose(icon.key)"
        @keydown="keyboard($event, index)"
      >
        <OptionIcon
          kind="expense"
          :name="icon.label"
          :icon="icon.key"
          :size="20"
        /><span>{{ icon.label }}</span>
      </button>
    </div>
  </fieldset>
</template>

<style scoped>
.icon-picker {
  border: 0;
  padding: 0;
  margin: 14px 0;
  min-width: 0;
}
.icon-picker legend {
  font-size: 12px;
  font-weight: 550;
  color: var(--accent-strong);
  padding: 0;
}
.icon-picker-preview {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 7px 0 8px;
  font-size: 11px;
  color: var(--accent-strong);
}
.icon-picker-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
  padding: 3px;
  max-height: 216px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.icon-choice {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 48px;
  min-height: 48px;
  padding: 4px 1px;
  background: var(--surface);
  border: 1px solid color-mix(in srgb, var(--accent) 15%, var(--surface));
  border-radius: 10px;
  color: var(--accent-strong);
  font-size: 9px;
  line-height: 1.2;
}
.icon-choice:hover:not(:disabled) {
  border-color: var(--muted);
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
}
.icon-choice[aria-checked="true"] {
  background: color-mix(in srgb, var(--accent) 9%, var(--surface));
  border-color: var(--accent-light);
  color: var(--accent-strong);
  box-shadow: inset 0 0 0 1px var(--accent-light);
}
.icon-choice:disabled {
  opacity: 0.5;
}
.icon-choice > span {
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
