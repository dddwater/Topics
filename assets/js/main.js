(() => {
  const toggle = document.getElementById("vibeToggle");
  const label = document.getElementById("vibeLabel");
  const status = document.getElementById("vibeStatus");
  const meter = document.querySelector(".vibe-meter");
  const bars = Array.from(document.querySelectorAll(".vibe-meter__bar"));

  const IDLE_HEIGHT = 5;
  const MAX_HEIGHT = 34;

  let active = false;
  let simTimer = null;
  let phase = 0;

  // 以中央為峰值的權重，讓兩側的 bar 自然收斂
  const weights = bars.map((_, i) => {
    const center = (bars.length - 1) / 2;
    return 1 - Math.abs(i - center) / (center + 1.4);
  });

  function render(level) {
    const clamped = Math.min(1, Math.max(0, level));
    bars.forEach((bar, i) => {
      const h = IDLE_HEIGHT + (MAX_HEIGHT - IDLE_HEIGHT) * clamped * weights[i];
      bar.style.height = `${h}px`;
    });
  }

  function reset() {
    bars.forEach((bar) => {
      bar.style.height = `${IDLE_HEIGHT}px`;
    });
  }

  // 聲音引擎尚未接上時的模擬訊號（平滑的偽隨機呼吸）
  function startSimulation() {
    simTimer = setInterval(() => {
      phase += 0.14;
      const wave = (Math.sin(phase) + Math.sin(phase * 2.3) * 0.5) / 1.5;
      render(0.42 + wave * 0.28 + Math.random() * 0.1);
    }, 90);
  }

  function stopSimulation() {
    clearInterval(simTimer);
    simTimer = null;
  }

  function start() {
    active = true;
    toggle.setAttribute("aria-pressed", "true");
    label.textContent = "停止";
    status.textContent = "聆聽環境音量中";
    meter.classList.add("is-active");

    // 聲音引擎組員可掛上 window.VibeAudioEngine
    // start({ onLevel }) 需以 0–1 的環境音量呼叫 onLevel
    if (window.VibeAudioEngine?.start) {
      window.VibeAudioEngine.start({ onLevel: render });
    } else {
      startSimulation();
    }
  }

  function stop() {
    active = false;
    toggle.setAttribute("aria-pressed", "false");
    label.textContent = "開始";
    status.textContent = "尚未啟動";
    meter.classList.remove("is-active");

    window.VibeAudioEngine?.stop?.();
    stopSimulation();
    reset();
  }

  toggle.addEventListener("click", () => (active ? stop() : start()));
  reset();
})();
