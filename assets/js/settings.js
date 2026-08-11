(() => {
  "use strict";

  const STORAGE_KEY = "vibespace.spaceSettings";
  const form = document.querySelector("#space-settings");
  const profileName = document.querySelector("#profile-name");
  const profileDescription = document.querySelector("#profile-description");
  const meterFill = document.querySelector("#profile-meter-fill");
  const saveStatus = document.querySelector("#save-status");

  const reflectionScores = {
    spaceSize: { small: 1, medium: 2, large: 3 },
    ceilingMaterial: { steel: 1, wood: 2, concrete: 3 }
  };

  function getSettings() {
    const data = new FormData(form);
    return {
      spaceSize: data.get("spaceSize"),
      ceilingMaterial: data.get("ceilingMaterial"),
      airConditioning: data.get("airConditioning")
    };
  }

  function updateProfile() {
    const settings = getSettings();
    const completed = Object.values(settings).filter(Boolean).length;
    meterFill.style.width = `${(completed / 3) * 100}%`;

    if (completed < 3) {
      profileName.textContent = completed ? `${completed} / 3 已完成` : "等待設定";
      profileDescription.textContent = "完成三項選擇後，我們會產生你的空間聲學輪廓。";
      return;
    }

    const reflection = reflectionScores.spaceSize[settings.spaceSize]
      + reflectionScores.ceilingMaterial[settings.ceilingMaterial];

    profileName.textContent = reflection >= 5
      ? "寬域沉浸"
      : reflection >= 3
        ? "平衡環繞"
        : "近場清晰";

    profileDescription.textContent = settings.airConditioning === "central"
      ? "建議採用穩定底噪補償，並保留較寬的動態混音範圍。"
      : "建議採用即時底噪偵測，柔和調整環境音的細節與音量。";
  }

  function restoreSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved) return;

      Object.entries(saved).forEach(([name, value]) => {
        const input = form.querySelector(`[name="${name}"][value="${value}"]`);
        if (input) input.checked = true;
      });
    } catch (error) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  form.addEventListener("change", () => {
    saveStatus.textContent = "";
    updateProfile();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const settings = getSettings();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent("vibespace:settings-saved", { detail: settings }));
    saveStatus.textContent = "設定已儲存在這台裝置，可供播放器讀取。";
  });

  window.VibeSpaceSettings = {
    get: getSettings,
    storageKey: STORAGE_KEY
  };

  restoreSettings();
  updateProfile();
})();
