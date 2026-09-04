(() => {
  "use strict";

  const { BRAND_PROFILES, createDemoHistory, summarizeHistory } = window.VibeSpaceInsights;

  const STATE_COLOR = { quiet: "var(--quiet)", social: "var(--social)", busy: "var(--busy)" };
  const STATE_LABEL = { quiet: "Quiet", social: "Social", busy: "Busy" };
  const DAY_NAMES = ["一", "二", "三", "四", "五", "六", "日"];

  const history = createDemoHistory();
  const summary = summarizeHistory(history);
  const todayHistory = history.filter((item) => item.day === 4);

  const select = document.getElementById("profile-select");
  Object.keys(BRAND_PROFILES).forEach((id) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = BRAND_PROFILES[id].name;
    select.appendChild(option);
  });
  select.value = "focus";

  document.getElementById("history-count").textContent = `共 ${history.length} 個小時區段`;

  function renderDonut() {
    const donut = document.getElementById("donut");
    donut.style.background = `conic-gradient(var(--quiet) 0 ${summary.quiet}%, var(--social) ${summary.quiet}% ${summary.quiet + summary.social}%, var(--busy) ${summary.quiet + summary.social}% 100%)`;
    const topState = ["quiet", "social", "busy"].reduce((a, b) => (summary[b] > summary[a] ? b : a));
    document.getElementById("donut-social").textContent = `${summary[topState]}%`;
    document.getElementById("donut-caption").textContent = `${STATE_LABEL[topState]} 為主`;

    const legend = document.getElementById("legend");
    legend.innerHTML = "";
    ["quiet", "social", "busy"].forEach((state) => {
      const row = document.createElement("div");
      row.innerHTML = `<i style="background:${STATE_COLOR[state]}"></i><span>${STATE_LABEL[state]}</span><strong>${summary[state]}%</strong>`;
      legend.appendChild(row);
    });
  }

  function renderBrandGap() {
    const profile = BRAND_PROFILES[select.value];
    document.getElementById("profile-chip").textContent = profile.name;
    document.getElementById("profile-description").textContent = profile.description;

    const rows = document.getElementById("gap-rows");
    rows.innerHTML = "";
    ["quiet", "social", "busy"].forEach((state) => {
      const gap = summary[state] - profile[state];
      const cls = gap > 3 ? "over" : gap < -3 ? "under" : "match";
      const row = document.createElement("div");
      row.className = "compare-row";
      row.innerHTML = `
        <span>${STATE_LABEL[state]}</span>
        <div class="compare-track"><i class="actual" style="width:${summary[state]}%;background:${STATE_COLOR[state]}"></i><b style="left:${profile[state]}%"></b></div>
        <strong class="${cls}">${gap > 0 ? "+" : ""}${gap}%</strong>
      `;
      rows.appendChild(row);
    });

    document.getElementById("recommendation-title").textContent = summary.busy > profile.busy
      ? "午後的 Busy 比例高於品牌目標。"
      : "本週聲景接近品牌目標。";
    document.getElementById("recommendation-body").textContent = summary.busy > profile.busy
      ? "建議觀察座位密度、設備噪音與午後營運模式；也可能只是本週客流增加，VibeSpace 不會單憑聲音替你下結論。"
      : "你可以繼續觀察月份與季節變化，再決定是否調整歌單或空間配置。";
  }

  function renderHeatmap() {
    const heatmap = document.getElementById("heatmap");
    heatmap.innerHTML = "";
    DAY_NAMES.forEach((dayName, day) => {
      const row = document.createElement("div");
      row.className = "heatmap-row";
      const cells = history
        .filter((item) => item.day === day)
        .map((item) => `<i class="heat-${item.state}" title="週${dayName} ${item.hour}:00 · ${item.state}"></i>`)
        .join("");
      row.innerHTML = `<strong>週${dayName}</strong><div>${cells}</div>`;
      heatmap.appendChild(row);
    });
  }

  function renderTimeline() {
    const timeline = document.getElementById("timeline");
    timeline.innerHTML = todayHistory
      .map((item) => `<i class="time-${item.state}">${item.hour}:00</i>`)
      .join("");
  }

  function renderStats() {
    document.getElementById("stat-transients").textContent = summary.transients;
    document.getElementById("stat-adjustments").textContent = summary.adjustments;
    document.getElementById("stat-overrides").textContent = summary.overrides;
  }

  select.addEventListener("change", renderBrandGap);

  renderDonut();
  renderBrandGap();
  renderHeatmap();
  renderTimeline();
  renderStats();
})();
