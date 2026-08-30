(() => {
  const userLabel = document.getElementById("userLabel");
  const totalSessions = document.getElementById("totalSessions");
  const totalDuration = document.getElementById("totalDuration");
  const favoriteMode = document.getElementById("favoriteMode");
  const recordsRoot = document.getElementById("records");
  const logoutButton = document.getElementById("logoutBtn");

  function formatDuration(seconds) {
    const total = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours) return `${hours} 小時 ${minutes} 分鐘`;
    if (minutes) return `${minutes} 分鐘`;
    return `${Math.round(total)} 秒`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    }[char]));
  }

  function modeLabel(mode) {
    return ({ comfort: "Comfort", balanced: "Balanced", flow: "Flow", manual: "Manual" })[mode] || mode || "未記錄";
  }

  async function load() {
    try {
      const user = await window.VibeSpaceAuth.requireUser();
      if (!user) return;
      userLabel.textContent = user.user_metadata?.display_name || user.email || "VibeSpace 使用者";

      const records = await window.VibeSpaceAuth.listUsageRecords(100);
      totalSessions.textContent = records.length;
      const duration = records.reduce((sum, record) => sum + (Number(record.duration_seconds) || 0), 0);
      totalDuration.textContent = formatDuration(duration);

      const counts = records.reduce((map, record) => {
        if (record.operation_mode) map[record.operation_mode] = (map[record.operation_mode] || 0) + 1;
        return map;
      }, {});
      const favorite = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
      favoriteMode.textContent = favorite ? modeLabel(favorite) : "—";

      if (!records.length) {
        recordsRoot.innerHTML = '<p class="empty">目前還沒有使用紀錄。回到主畫面啟動一次 VibeSpace 後，紀錄就會出現在這裡。</p>';
        return;
      }

      recordsRoot.innerHTML = records.map((record) => {
        const start = new Date(record.started_at);
        return `<article class="record">
          <div class="record-top"><strong>${escapeHtml(start.toLocaleString("zh-TW"))}</strong><span>${escapeHtml(formatDuration(record.duration_seconds))}</span></div>
          <small>模式：${escapeHtml(modeLabel(record.operation_mode))} ・ 空間：${escapeHtml(record.acoustic_profile || "自動偵測")}${Number.isFinite(record.avg_db) ? ` ・ 平均 ${record.avg_db.toFixed(1)} dB` : ""}</small>
        </article>`;
      }).join("");
    } catch (error) {
      recordsRoot.innerHTML = `<p class="empty">${escapeHtml(error.message || "無法載入使用紀錄")}</p>`;
    }
  }

  logoutButton.addEventListener("click", async () => {
    await window.VibeSpaceAuth.signOut();
    window.location.href = "login.html";
  });

  load();
})();
