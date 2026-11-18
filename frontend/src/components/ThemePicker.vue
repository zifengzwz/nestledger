<script setup lang="ts">
import { ref } from "vue";
import { Check } from "lucide-vue-next";
import { THEMES, type ThemeId } from "../theme";
const props = defineProps<{ modelValue: ThemeId; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [theme: ThemeId] }>();
const group = ref<HTMLElement>();
function choose(id: ThemeId) {
  if (!props.disabled && id !== props.modelValue) emit("update:modelValue", id);
}
function keyboard(event: KeyboardEvent, index: number) {
  const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  let target: number;
  if (event.key === "Home") target = 0;
  else if (event.key === "End") target = THEMES.length - 1;
  else if (Object.prototype.hasOwnProperty.call(steps, event.key)) target = (index + steps[event.key] + THEMES.length) % THEMES.length;
  else return;
  event.preventDefault();
  choose(THEMES[target].id);
  group.value?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[target]?.focus();
}
</script>

<template>
  <div ref="group" class="theme-picker" role="radiogroup" aria-label="界面色调">
    <button
      v-for="theme in THEMES"
      :key="theme.id"
      type="button"
      role="radio"
      class="theme-choice"
      :class="[`theme-${theme.id}`, { selected: modelValue === theme.id }]"
      :aria-checked="modelValue === theme.id"
      :data-theme-choice="theme.id"
      :disabled="disabled"
      :tabindex="modelValue === theme.id ? 0 : -1"
      @click="choose(theme.id)"
      @keydown="keyboard($event, THEMES.indexOf(theme))"
    >
      <span class="theme-swatch" aria-hidden="true">
        <i :style="{ background: theme.accent }"></i>
        <i :style="{ background: theme.accentSoft }"></i>
        <i :style="{ background: 'var(--surface)' }"></i>
      </span>
      <span class="theme-name">{{ theme.name }}</span>
      <span class="theme-hint">{{ theme.hint }}</span>
      <Check v-if="modelValue === theme.id" :size="15" class="theme-check" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.theme-picker {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 4px;
}
.theme-choice {
  position: relative;
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr);
  grid-template-rows: auto auto;
  column-gap: 10px;
  align-items: center;
  text-align: left;
  padding: 11px 12px;
  min-height: 64px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  color: var(--text);
  transition:
    border-color 0.15s,
    background 0.15s,
    box-shadow 0.15s;
}
.theme-choice:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 4%, var(--surface));
}
.theme-choice.selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  box-shadow: inset 0 0 0 1px var(--accent);
}
.theme-choice:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.theme-swatch {
  grid-row: 1 / span 2;
  display: flex;
  width: 46px;
  height: 46px;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--border);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.35);
}
.theme-swatch i {
  flex: 1;
}
.theme-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.theme-hint {
  font-size: 11px;
  color: var(--muted);
}
.theme-check {
  position: absolute;
  top: 9px;
  right: 9px;
  color: var(--accent);
}
@media (max-width: 380px) {
  .theme-picker {
    grid-template-columns: 1fr;
  }
}
</style>
