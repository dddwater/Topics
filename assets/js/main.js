// Web Audio engine — mic analysis feeds the vibespace context-engine state
// machine (assets/js/context-engine.js), which drives a single-track
// player (assets/js/soundscape-player.js) instead of the previous raw
// oscillator tone. Ported from emma63194/vibespace (app/page.tsx cockpit).
(() => {
  const { decideContext, DEFAULT_CALIBRATION } = window.VibeSpaceContextEngine;
  const { SoundscapePlayer, getSoundscapeMeta, getSoundscapeTrackCount } = window.VibeSpaceSoundscape;
  const { NonRepeatingTrackSelector } = window.VibeSpaceTrackSelection;

  const STORAGE_KEY = "vibespace.spaceSettings";
  const DEFAULT_PROFILE = {
    id: "automatic",
    name: "自動偵測",
    description: "尚未套用場地設定，使用系統預設校準。",
  };

  const CALIBRATION_PRESETS = {
    "near-field": {
      quietBaselineDbRel: -50,
      normalBaselineDbRel: -40,
      preferredGainDb: -26,
      minimumGainDb: -36,
      hardCeilingGainDb: -18,
    },
    "balanced-surround": DEFAULT_CALIBRATION,
    "wide-immersive": {
      quietBaselineDbRel: -42,
      normalBaselineDbRel: -32,
      preferredGainDb: -18,
      minimumGainDb: -28,
      hardCeilingGainDb: -10,
    },
  };

  let audioContext = null;
  let analyser = null;
  let microphoneSource = null;
  let microphoneStream = null;
  let animationFrameId = null;
  let onLevel = null;
  let onDecision = null;
  let onTrackChange = null;
  let player = null;
  const trackSelector = new NonRepeatingTrackSelector(getSoundscapeTrackCount, { historySize: 2 });

  let activeProfile = DEFAULT_PROFILE;
  let settingsSource = "automatic";
  let operationMode = "balanced";
  let calibration = DEFAULT_CALIBRATION;

  let currentState = "social";
  let currentGainDb = DEFAULT_CALIBRATION.preferredGainDb;
  let startedAt = 0;
  let smoothedLongTermDb = DEFAULT_CALIBRATION.normalBaselineDbRel;
  let trackIndexes = { low: null, medium: null, high: null };

  function selectRandomTrack(energy, reason) {
    const nextIndex = trackSelector.next(energy, trackIndexes[energy]);
    trackIndexes = { ...trackIndexes, [energy]: nextIndex };
    const meta = getSoundscapeMeta(energy, nextIndex);
    if (player?.active) player.setTrack(energy, nextIndex);
    onTrackChange?.(meta, { energy, trackIndex: nextIndex, reason });
    return meta;
  }

  function handleTrackCycleComplete(event) {
    if (!player
      || event.energy !== player.activeEnergy
      || event.trackIndex !== player.activeTrackIndex) return;

    const nextEnergy = currentDecisionEnergy();
    const reason = nextEnergy === event.energy
      ? "cycle-complete"
      : "environment-change-after-cycle";
    selectRandomTrack(nextEnergy, reason);
  }

  function loadSavedSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      const profile = saved?.acousticProfile;
      const validManualSettings = saved?.version === 2
        && saved?.source === "manual"
        && profile?.name
        && profile?.id;

      return {
        profile: validManualSettings ? profile : null,
        operationMode: saved?.operationMode || "balanced",
      };
    } catch (error) {
      return { profile: null, operationMode: "balanced" };
    }
  }

  function getConfiguration() {
    const saved = loadSavedSettings();
    const profile = saved.profile || DEFAULT_PROFILE;
    return {
      source: saved.profile ? "manual" : "automatic",
      profile,
      operationMode: saved.operationMode,
      calibration: CALIBRATION_PRESETS[profile.id] || DEFAULT_CALIBRATION,
    };
  }

  function runDecision(longTermDbRel, shortTermDbRel, transientScore, sustainedSeconds) {
    const decision = decideContext({
      shortTermDbRel,
      longTermDbRel,
      transientScore,
      dataQuality: 0.94,
      sustainedSeconds,
      currentState,
      currentGainDb,
      operationMode,
      calibration,
      canChangeTrack: true,
      manualHold: operationMode === "manual",
    });

    if (decision.state !== "transient" && decision.state !== "uncertain") {
      currentState = decision.state;
    }
    currentGainDb = decision.targetGainDb;
    if (player) {
      player.setTargetGainDb(decision.targetGainDb);
    }

    onDecision?.(decision, { longTermDbRel, shortTermDbRel });
    return decision;
  }

  function measure() {
    if (!analyser || !audioContext) return;

    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (let index = 0; index < samples.length; index += 1) sum += samples[index] ** 2;
    const rms = Math.sqrt(sum / samples.length);
    const db = 20 * Math.log10(Math.max(rms, 0.00001));

    smoothedLongTermDb = smoothedLongTermDb * 0.94 + db * 0.06;
    const spike = Math.max(0, db - smoothedLongTermDb);
    const transientScore = Math.min(1, spike / 11);
    const sustainedSeconds = Math.min(120, (Date.now() - startedAt) / 1000);

    const decision = runDecision(smoothedLongTermDb, db, transientScore, sustainedSeconds);
    onLevel?.(Math.min(1, Math.max(0, (db + 60) / 60)), { rms, db, decision });

    animationFrameId = requestAnimationFrame(measure);
  }

  function skipTrack() {
    const energy = currentDecisionEnergy();
    return selectRandomTrack(energy, "manual-skip");
  }

  function currentDecisionEnergy() {
    if (currentState === "quiet") return "low";
    if (currentState === "busy") return "high";
    return "medium";
  }

  async function start(options = {}) {
    if (microphoneStream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("此瀏覽器不支援麥克風輸入");
    }

    onLevel = options.onLevel;
    onDecision = options.onDecision;
    onTrackChange = options.onTrackChange;

    const configuration = getConfiguration();
    activeProfile = configuration.profile;
    settingsSource = configuration.source;
    operationMode = configuration.operationMode;
    calibration = configuration.calibration;
    currentState = "social";
    currentGainDb = calibration.preferredGainDb;
    smoothedLongTermDb = calibration.normalBaselineDbRel;
    trackIndexes = { low: null, medium: null, high: null };
    trackSelector.reset();

    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
    });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    microphoneSource = audioContext.createMediaStreamSource(microphoneStream);
    microphoneSource.connect(analyser);

    player ||= new SoundscapePlayer({ onTrackCycleComplete: handleTrackCycleComplete });
    player.onTrackCycleComplete = handleTrackCycleComplete;
    const initialIndex = trackSelector.next("medium", null);
    trackIndexes.medium = initialIndex;
    await player.play("medium", currentGainDb, initialIndex);
    onTrackChange?.(getSoundscapeMeta("medium", initialIndex), {
      energy: "medium",
      trackIndex: initialIndex,
      reason: "start",
    });

    void window.VibeSpaceFreesound?.refreshAll?.().catch(() => undefined);

    startedAt = Date.now();
    measure();
    return { source: settingsSource, profileName: activeProfile.name, operationMode };
  }

  async function stop() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    microphoneSource?.disconnect();
    microphoneSource = null;
    microphoneStream?.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
    if (audioContext && audioContext.state !== "closed") await audioContext.close();
    audioContext = null;
    analyser = null;
    await player?.destroy();
    player = null;
    onLevel = null;
    onDecision = null;
    onTrackChange = null;
  }

  function setOperationMode(mode) {
    operationMode = mode;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      saved.operationMode = mode;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch (error) {
      // Ignore storage failures (e.g. private browsing) — mode still applies live.
    }
  }

  function getCurrentTrack() {
    const energy = currentDecisionEnergy();
    const index = trackIndexes[energy];
    return index == null ? null : getSoundscapeMeta(energy, index);
  }

  window.VibeAudioEngine = { start, stop, getConfiguration, getCurrentTrack, skipTrack, setOperationMode };
  window.addEventListener("pagehide", () => {
    void stop();
  });
})();

(() => {
  const toggle = document.getElementById("vibeToggle");
  const label = document.getElementById("vibeLabel");
  const status = document.getElementById("vibeStatus");
  const meter = document.querySelector(".vibe-meter");
  const bars = Array.from(document.querySelectorAll(".vibe-meter__bar"));
  const modeButtons = Array.from(document.querySelectorAll("[data-vibe-mode]"));
  const trackLabel = document.getElementById("vibeTrack");
  const skipButton = document.getElementById("vibeSkip");

  const IDLE_HEIGHT = 5;
  const MAX_HEIGHT = 34;
  const STATE_LABELS = {
    quiet: "Quiet · 安靜沉著",
    social: "Social · 穩定交流",
    busy: "Busy · 尖峰活躍",
    transient: "Transient · 短暫事件",
    uncertain: "Uncertain · 等待確認",
  };

  let active = false;
  let simTimer = null;
  let phase = 0;

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

  function renderDecision(decision) {
    if (!decision) return;
    status.textContent = `${STATE_LABELS[decision.state] || decision.state} ・ ${decision.reason}`;
  }

  function renderTrack(meta) {
    if (meta && trackLabel) trackLabel.textContent = `${meta.title} · ${meta.subtitle}`;
  }

  function setActiveMode(mode) {
    modeButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.vibeMode === mode);
    });
  }

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

  async function start() {
    active = true;
    toggle.disabled = true;
    toggle.setAttribute("aria-pressed", "true");
    label.textContent = "停止";
    status.textContent = "聆聽環境音量中";
    meter.classList.add("is-active");

    try {
      if (window.VibeAudioEngine?.start) {
        const engineState = await window.VibeAudioEngine.start({
          onLevel: render,
          onDecision: renderDecision,
          onTrackChange: renderTrack,
        });
        setActiveMode(engineState.operationMode);
        status.textContent = engineState.source === "manual"
          ? `已套用「${engineState.profileName}」・聆聽環境中`
          : "自動偵測中・聆聽環境音量";
      } else {
        startSimulation();
      }
      window.dispatchEvent(new CustomEvent("vibespace:session-start"));
    } catch (error) {
      active = false;
      toggle.setAttribute("aria-pressed", "false");
      label.textContent = "開始";
      status.textContent = error.message || "無法啟用麥克風";
      meter.classList.remove("is-active");
      reset();
    } finally {
      toggle.disabled = false;
    }
  }

  async function stop() {
    active = false;
    toggle.setAttribute("aria-pressed", "false");
    label.textContent = "開始";
    status.textContent = "尚未啟動";
    meter.classList.remove("is-active");
    if (trackLabel) trackLabel.textContent = "";

    await window.VibeAudioEngine?.stop?.();
    stopSimulation();
    reset();
    window.dispatchEvent(new CustomEvent("vibespace:session-stop"));
  }

  toggle.addEventListener("click", () => {
    if (active) void stop();
    else void start();
  });

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.vibeMode;
      window.VibeAudioEngine?.setOperationMode?.(mode);
      setActiveMode(mode);
    });
  });

  skipButton?.addEventListener("click", () => {
    if (!active) return;
    const meta = window.VibeAudioEngine?.skipTrack?.();
    if (meta && trackLabel) trackLabel.textContent = `${meta.title} · ${meta.subtitle}`;
  });

  const initialConfiguration = window.VibeAudioEngine?.getConfiguration?.();
  if (initialConfiguration) {
    setActiveMode(initialConfiguration.operationMode);
    if (initialConfiguration.source === "manual") {
      status.textContent = `已準備「${initialConfiguration.profile.name}」手動設定`;
    }
  }
  reset();
})();


