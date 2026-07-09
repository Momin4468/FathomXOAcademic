"use client";
/**
 * Personal-Finance chart surface. The chart primitives now live in the shared
 * `Charts` module (reused by the business dashboards too); re-exported here so the
 * PF pages keep importing from `@/components/PfCharts`. `PF_PALETTE` is the old
 * name for the shared `CHART_PALETTE`.
 */
export { Donut, IncomeExpenseBars, NetTrend, CHART_PALETTE as PF_PALETTE } from "./Charts";
