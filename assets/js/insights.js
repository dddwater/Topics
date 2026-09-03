// Brand profiles + acoustic-atmosphere statistics, ported from
// emma63194/vibespace (lib/insights.ts) into vanilla JS.
(() => {
  "use strict";

  const BRAND_PROFILES = {
    focus: {
      name: "專注工作型",
      description: "低干擾、可閱讀與工作",
      quiet: 45,
      social: 45,
      busy: 10,
    },
    balanced: {
      name: "平衡交流型",
      description: "日常交談與適度活力",
      quiet: 25,
      social: 55,
      busy: 20,
    },
    social: {
      name: "熱鬧社交型",
      description: "聚會、交流與較高能量",
      quiet: 10,
      social: 60,
      busy: 30,
    },
  };

  const seeded = (value) => {
    const x = Math.sin(value * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };

  // Demo history covering a week of opening hours, used until real event
  // logs accumulate. Each slice is one hour of one day.
  function createDemoHistory() {
    const rows = [];
    for (let day = 0; day < 7; day += 1) {
      for (let hour = 8; hour < 20; hour += 1) {
        const lunch = hour >= 11 && hour <= 13;
        const afternoon = hour >= 14 && hour <= 16;
        const weekend = day >= 5;
        const energy = seeded(day * 31 + hour * 7);
        let state = "social";
        if (hour <= 9 || (afternoon && !weekend && energy < 0.56)) state = "quiet";
        if ((lunch && energy > 0.2) || (weekend && hour >= 13 && energy > 0.35)) state = "busy";
        rows.push({
          day,
          hour,
          state,
          transientCount: Math.floor(seeded(day * 17 + hour) * 6),
          autoAdjustments: state === "social" ? 1 : state === "busy" ? 2 : 0,
          manualOverrides: seeded(day * 43 + hour * 2) > 0.91 ? 1 : 0,
        });
      }
    }
    return rows;
  }

  // Rounds each share to a whole percentage while guaranteeing they still sum
  // to exactly 100 (largest-remainder method). Rounding quiet/social/busy
  // independently can overshoot to 101 or undershoot to 99, which breaks any
  // consumer that assumes the three segments tile a whole (e.g. a donut
  // chart's conic-gradient stops).
  function roundPercentagesTo100(counts, total) {
    const keys = ["quiet", "social", "busy"];
    const raw = keys.map((key) => (counts[key] / total) * 100);
    const floored = raw.map(Math.floor);
    const remainder = 100 - floored.reduce((sum, value) => sum + value, 0);
    const order = keys
      .map((key, index) => ({ key, frac: raw[index] - floored[index] }))
      .sort((a, b) => b.frac - a.frac);
    const result = Object.fromEntries(keys.map((key, index) => [key, floored[index]]));
    for (let i = 0; i < remainder; i += 1) {
      result[order[i % order.length].key] += 1;
    }
    return result;
  }

  function summarizeHistory(history) {
    const counts = { quiet: 0, social: 0, busy: 0 };
    let transients = 0;
    let adjustments = 0;
    let overrides = 0;
    history.forEach((slice) => {
      counts[slice.state] += 1;
      transients += slice.transientCount;
      adjustments += slice.autoAdjustments;
      overrides += slice.manualOverrides;
    });
    const total = Math.max(1, history.length);
    return {
      ...roundPercentagesTo100(counts, total),
      transients,
      adjustments,
      overrides,
    };
  }

  window.VibeSpaceInsights = { BRAND_PROFILES, createDemoHistory, summarizeHistory };
})();
