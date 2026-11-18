<script setup lang="ts">
import { computed } from "vue";
const props = defineProps<{
  points: { label: string; incomeCents: number; expenseCents: number }[];
}>();
const max = computed(() =>
  Math.max(
    100,
    ...props.points.flatMap((p) => [p.incomeCents, p.expenseCents]),
  ),
);
const x = (i: number) => 60 + (i * 660) / Math.max(1, props.points.length - 1);
const y = (value: number) => 205 - (value / max.value) * 160;
const line = (kind: "incomeCents" | "expenseCents") =>
  props.points.map((p, i) => `${x(i)},${y(p[kind])}`).join(" ");
const labels = computed(() =>
  props.points
    .map((p, i) => ({ ...p, i }))
    .filter(
      (p) =>
        p.i === 0 ||
        p.i === props.points.length - 1 ||
        p.i % Math.max(1, Math.ceil(props.points.length / 7)) === 0,
    ),
);
</script>
<template>
  <div class="chart">
    <svg viewBox="0 0 760 255" role="img" aria-label="当前周期收入与支出趋势图">
      <g v-for="i in 5" :key="i">
        <line
          class="chart-grid"
          x1="60"
          x2="720"
          :y1="45 + (i - 1) * 40"
          :y2="45 + (i - 1) * 40"
          stroke-dasharray="4 5"
        />
        <text
          x="48"
          :y="49 + (i - 1) * 40"
          text-anchor="end"
          class="chart-label"
        >
          {{
            ((max * (5 - i)) / 4 / 100).toLocaleString("zh-CN", {
              maximumFractionDigits: 0,
            })
          }}
        </text>
      </g>
      <polyline
        :points="line('incomeCents')"
        class="income-line"
        fill="none"
        stroke-width="3"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <polyline
        :points="line('expenseCents')"
        class="expense-line"
        fill="none"
        stroke-width="3"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <g v-for="(p, i) in points" :key="i">
        <circle class="income-dot" :cx="x(i)" :cy="y(p.incomeCents)" r="3">
          <title>
            {{ p.label }} 收入 ¥{{ (p.incomeCents / 100).toFixed(2) }}
          </title>
        </circle>
        <circle class="expense-dot" :cx="x(i)" :cy="y(p.expenseCents)" r="3">
          <title>
            {{ p.label }} 支出 ¥{{ (p.expenseCents / 100).toFixed(2) }}
          </title>
        </circle>
      </g>
      <text
        v-for="p in labels"
        :key="p.i"
        :x="x(p.i)"
        y="237"
        text-anchor="middle"
        class="chart-label"
      >
        {{ p.label }}
      </text>
    </svg>
  </div>
</template>

<style scoped>
.chart-grid { stroke: var(--border); }
.income-line { stroke: var(--income); }
.expense-line { stroke: var(--expense-line); }
.income-dot { fill: var(--income); }
.expense-dot { fill: var(--expense-line); }
</style>
