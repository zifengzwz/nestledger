<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { X } from "lucide-vue-next";
const props = defineProps<{ title: string; busy?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement>();
let previous: HTMLElement | null = null;
function keyboard(event: KeyboardEvent) {
  if (event.key === "Escape" && !props.busy) emit("close");
  if (event.key !== "Tab") return;
  const nodes = Array.from(
    panel.value?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
    ) || [],
  );
  const first = nodes[0],
    last = nodes[nodes.length - 1];
  if (!first) {
    event.preventDefault();
    panel.value?.focus();
    return;
  }
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === panel.value)
  ) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
onMounted(async () => {
  previous = document.activeElement as HTMLElement;
  document.body.style.overflow = "hidden";
  await nextTick();
  (panel.value?.querySelector("[autofocus]") as HTMLElement | null)?.focus();
  if (!panel.value?.contains(document.activeElement)) panel.value?.focus();
  document.addEventListener("keydown", keyboard);
});
onBeforeUnmount(() => {
  document.body.style.overflow = "";
  document.removeEventListener("keydown", keyboard);
  previous?.focus();
});
</script>
<template>
  <div class="modal-backdrop" @click.self="!busy && emit('close')">
    <section
      ref="panel"
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      tabindex="-1"
    >
      <header class="modal-head">
        <h2 id="modal-title">{{ title }}</h2>
        <button
          class="icon-button"
          aria-label="关闭弹窗"
          :disabled="busy"
          @click="emit('close')"
        >
          <X :size="20" />
        </button>
      </header>
      <slot />
    </section>
  </div>
</template>
