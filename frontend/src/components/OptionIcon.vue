<script setup lang="ts">
import { computed } from "vue";
import { iconById, optionIcon, type OptionIconKind } from "../optionIcons";
const props = withDefaults(
  defineProps<{
    name: string;
    kind: OptionIconKind;
    size?: number;
    icon?: string;
  }>(),
  { size: 18 },
);
const definition = computed(
  () => iconById(props.icon) ?? optionIcon(props.kind, props.name),
);
</script>

<template>
  <component
    :is="definition.component"
    :size="size"
    :stroke-width="1.8"
    class="option-icon"
    :data-option-icon="definition.key"
    :data-icon-kind="kind"
    :style="definition.color ? { color: definition.color } : undefined"
    aria-hidden="true"
    focusable="false"
  />
</template>

<style scoped>
.option-icon {
  flex-shrink: 0;
  vertical-align: middle;
}
</style>
