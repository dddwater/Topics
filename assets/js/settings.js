(() => {
  "use strict";

  const STORAGE_KEY = "vibespace.spaceSettings";
  const form = document.querySelector("#space-settings");
  const profileName = document.querySelector("#profile-name");
  const profileDescription = document.querySelector("#profile-description");
  const meterFill = document.querySelector("#profile-meter-fill");
  const saveStatus = document.querySelector("#save-status");

  const scores = {
    spaceSize: { small: 1, medium: 2, large: 3 },
    environment: { office: 1, classroom: 1, cafe: 2, restaurant: 3 },
    spaceType: { enclosed: 1, semiOpen: 2, open: 3 }
  };

  const environmentLabels = {
    restaurant: "餐廳",
    office: "辦公室",
    cafe: "咖啡廳",
    classroom: "教室／會議室"
  };

  const spaceTypeLabels = {
    open: "開放空間",
    semiOpen: "半開放空間",
    enclosed: "封閉空間"
  };

  const profiles = {
    near: {
      id: "near-field",
      name: "近場清晰",
      description: "以語音清晰與細節為主，降低空間反射造成的干擾。",
      baseGain: 0.04,
      maxGain: 0.065,
      noiseSensitivity: 0.45,
      updateInterval: 520
    },
    balanced: {
      id: "balanced-surround",
      name: "平衡環繞",
      description: "兼顧人聲與環境底噪，採用平穩、自然的動態混音。",
      baseGain: 0.055,
      maxGain: 0.08,
      noiseSensitivity: 0.5,
      updateInterval: 400
    },
    immersive: {
      id: "wide-immersive",
      name: "寬域沉浸",
      description: "針對較大或開放空間加強覆蓋，並更快回應環境變化。",
      baseGain: 0.065,
      maxGain: 0.095,
      noiseSensitivity: 0.55,
      updateInterval: 300
    }
  };

  function getSelections() {
    const data = new FormData(form);
    return {
      spaceSize: data.get("spaceSize"),
      environment: data.get("environment"),
      spaceType: data.get("spaceType")
    };
  }

  function resolveProfile(settings) {
    const total = scores.spaceSize[settings.spaceSize]
      + scores.environment[settings.environment]
      + scores.spaceType[settings.spaceType];

    if (total >= 8) return profiles.immersive;
    if (total >= 5) return profiles.balanced;
    return profiles.near;
  }

  function buildSettings() {
    const selections = getSelections();
    return {
      version: 2,
      source: "manual",
      ...selections,
      acousticProfile: { ...resolveProfile(selections) },
      savedAt: new Date().toISOString()
    };
  }

  function updateProfile() {
    const settings = getSelections();
    const completed = Object.values(settings).filter(Boolean).length;
    meterFill.style.width = `${(completed / 3) * 100}%`;

    if (completed < 3) {
      profileName.textContent = completed ? `${completed} / 3 已完成` : "等待設定";
      profileDescription.textContent = "完成三項選擇後，我們會產生你的空間聲學輪廓。";
      return;
    }

    const profile = resolveProfile(settings);
    profileName.textContent = profile.name;
    profileDescription.textContent = `${environmentLabels[settings.environment]}・${spaceTypeLabels[settings.spaceType]}：${profile.description}`;
  }

  function restoreSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved) return;

      ["spaceSize", "environment", "spaceType"].forEach((name) => {
        const value = saved[name];
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

    const settings = buildSettings();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    window.dispatchEvent(new CustomEvent("vibespace:settings-saved", { detail: settings }));
    saveStatus.textContent = `已儲存「${settings.acousticProfile.name}」，偵測頁面將優先使用這組設定。`;
  });

  window.VibeSpaceSettings = {
    get: buildSettings,
    storageKey: STORAGE_KEY
  };

  restoreSettings();
  updateProfile();
})();
