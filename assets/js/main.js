// Web Audio engine — mic analysis feeds the vibespace context-engine state
// machine (assets/js/context-engine.js), which drives a single-track
// player (assets/js/soundscape-player.js) instead of the previous raw
// oscillator tone. Ported from emma63194/vibespace (app/page.tsx cockpit).
(() => {
  const { decideContext, DEFAULT_CALIBRATION } = window.VibeSpaceContextEngine;
  const { SoundscapePlayer, getSoundscapeMeta, getSoundscapeTrackCount } = window.VibeSpaceSoundscape;
  const { NonRepeatingTrackSelector } = window.VibeSpaceTrackSelection;

  const STORAGE_KEY = "vibespace.spaceSettings";
  const VALID_OPERATION_MODES = ["comfort", "balanced", "flow", "manual"];
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
  let latestDecisionEnergy = "medium";
  let candidateState = "social";
  let candidateStartedAt = 0;
  let currentGainDb = DEFAULT_CALIBRATION.preferredGainDb;
  let startedAt = 0;
  let smoothedLongTermDb = DEFAULT_CALIBRATION.normalBaselineDbRel;
  let trackIndexes = { low: null, medium: null, high: null };

  async function selectRandomTrack(energy, reason) {
    const nextIndex = trackSelector.next(energy, trackIndexes[energy]);
    const meta = player?.active
      ? await player.setTrack(energy, nextIndex)
      : getSoundscapeMeta(energy, nextIndex);
    if (!meta) return null;
    trackIndexes = { ...trackIndexes, [energy]: nextIndex };
    onTrackChange?.(meta, { energy, trackIndex: nextIndex, reason });
    return meta;
  }

  function handleTrackEnded(event) {
    if (!player
      || operationMode === "manual"
      || event.energy !== player.activeEnergy
      || event.trackIndex !== player.activeTrackIndex
      || latestDecisionEnergy === event.energy) return false;

    void selectRandomTrack(latestDecisionEnergy, "environment-change-after-track");
    return true;
  }

  function handleTrackCycleComplete(event) {
    if (!player
      || event.energy !== player.activeEnergy
      || event.trackIndex !== player.activeTrackIndex) return;

    // Manual mode must never auto-switch category ("曲風都不會自動變化"), but the
    // track still has to keep playing once its loop cycle ends — silence isn't an
    // option either. Force the same category so playback continues within it,
    // ignoring latestDecisionEnergy (which tracks the ambient decision engine, not
    // the operator's manual choice).
    const nextEnergy = operationMode === "manual" ? event.energy : latestDecisionEnergy;
    const reason = nextEnergy === event.energy
      ? "cycle-complete"
      : "environment-change-after-cycle";
    void selectRandomTrack(nextEnergy, reason);
  }

  function loadSavedSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        // Automatically purge legacy space settings from removed space-settings page
        if (saved?.source === "manual" || saved?.acousticProfile?.id === "near-field") {
          localStorage.removeItem(STORAGE_KEY);
          return { profile: null, operationMode: "balanced" };
        }
        const operationMode = VALID_OPERATION_MODES.includes(saved?.operationMode)
          ? saved.operationMode
          : "balanced";
        return { profile: null, operationMode };
      }
      return { profile: null, operationMode: "balanced" };
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

  // dataQuality feeds context-engine.js's LOW_DATA_QUALITY safety hold, so it
  // must reflect whether the mic signal is actually trustworthy: an
  // ended/muted track (hardware unplugged, OS-level mute) or a signal that's
  // essentially silent or clipped should not be treated as reliable input.
  function computeDataQuality(rms) {
    const track = microphoneStream?.getTracks?.()[0];
    if (track && (track.readyState === "ended" || track.muted === true)) return 0.2;
    if (rms < 0.00003) return 0.35;
    if (rms > 0.9) return 0.4;
    return 0.94;
  }

  function runDecision(longTermDbRel, shortTermDbRel, transientScore, sustainedSeconds, dataQuality) {
    const decisionTime = Date.now();
    // Manual mode short-circuits decideContext before it ever updates the
    // candidate tracker, so a pending (unconfirmed) candidate from just
    // before Manual was engaged would otherwise sit frozen and keep
    // accumulating candidateSeconds for the whole Manual session. Re-syncing
    // the tracker to currentState on every Manual tick means the instant
    // Manual is turned off, any still-pending candidate has to earn a fresh
    // confirmation window instead of instantly "confirming" off stale time.
    if (operationMode === "manual") {
      candidateState = currentState;
      candidateStartedAt = decisionTime;
    }
    const candidateSeconds = candidateStartedAt
      ? (decisionTime - candidateStartedAt) / 1000
      : 0;
    const decision = decideContext({
      shortTermDbRel,
      longTermDbRel,
      transientScore,
      dataQuality,
      sustainedSeconds,
      currentState,
      currentGainDb,
      operationMode,
      calibration,
      candidateState,
      candidateSeconds,
      canChangeTrack: true,
      manualHold: operationMode === "manual",
    });

    if (decision.candidateState && decision.candidateState !== candidateState) {
      candidateState = decision.candidateState;
      candidateStartedAt = decisionTime;
    }

    if (decision.state !== "transient" && decision.state !== "uncertain") {
      currentState = decision.state;
      latestDecisionEnergy = decision.energy;
    }
    if (candidateState === currentState) candidateStartedAt = decisionTime;
    currentGainDb = decision.targetGainDb;
    if (player) {
      player.setTargetGainDb(decision.targetGainDb);
    }

    onDecision?.(decision, {
      longTermDbRel,
      shortTermDbRel,
      activeEnergy: player?.activeEnergy || null,
    });
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
    const dataQuality = computeDataQuality(rms);

    const decision = runDecision(smoothedLongTermDb, db, transientScore, sustainedSeconds, dataQuality);
    onLevel?.(Math.min(1, Math.max(0, (db + 60) / 60)), { rms, db, decision });

    animationFrameId = requestAnimationFrame(measure);
  }

  function skipTrack() {
    const energy = latestDecisionEnergy;
    return selectRandomTrack(energy, "manual-skip");
  }

  async function start(options = {}) {
    if (microphoneStream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("此瀏覽器不支援麥克風輸入");
    }
    const session = await window.VibeSpaceAuth?.getSession?.().catch(() => null);
    if (!session) {
      throw new Error("請先登入才能使用麥克風聆聽功能");
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
    latestDecisionEnergy = "medium";
    candidateState = "social";
    candidateStartedAt = Date.now();
    currentGainDb = calibration.preferredGainDb;
    smoothedLongTermDb = calibration.normalBaselineDbRel;
    trackIndexes = { low: null, medium: null, high: null };
    trackSelector.reset();

    let initialIndex;
    try {
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
      });
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      microphoneSource = audioContext.createMediaStreamSource(microphoneStream);
      microphoneSource.connect(analyser);

      player ||= new SoundscapePlayer({
        onTrackEnded: handleTrackEnded,
        onTrackCycleComplete: handleTrackCycleComplete,
      });
      player.onTrackEnded = handleTrackEnded;
      player.onTrackCycleComplete = handleTrackCycleComplete;
      initialIndex = trackSelector.next("medium", null);
      trackIndexes.medium = initialIndex;
      await player.play("medium", currentGainDb, initialIndex);
    } catch (error) {
      // A rejection here (autoplay policy, no mic hardware, ...) must not leave the
      // mic/AudioContext acquired above dangling — otherwise the browser mic
      // indicator stays on and every retry short-circuits on `if (microphoneStream)
      // return;` above. Run the same teardown stop() does before re-throwing.
      await stop();
      throw error;
    }
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
    if (audioContext && audioContext.state !== "closed") {
      await audioContext.close().catch((error) => console.error("audioContext.close() failed", error));
    }
    audioContext = null;
    analyser = null;
    await player?.destroy().catch((error) => console.error("player.destroy() failed", error));
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
    return player?.active?.meta || null;
  }

  window.VibeAudioEngine = { start, stop, getConfiguration, getCurrentTrack, skipTrack, setOperationMode };
})();

(() => {
  const toggle = document.getElementById("vibeToggle");
  const label = document.getElementById("vibeLabel");
  const status = document.getElementById("vibeStatus");
  const meter = document.querySelector(".vibe-meter");
  const bars = Array.from(document.querySelectorAll(".vibe-meter__bar"));
  const modeButtons = Array.from(document.querySelectorAll("[data-vibe-mode]"));
  const modeCaption = document.getElementById("vibeModeCaption");
  const modeDetailsToggle = document.getElementById("vibeModeDetailsToggle");
  const modeDetailsPanel = document.getElementById("vibeModeDetailsPanel");
  const trackLabel = document.getElementById("vibeTrack");
  const skipButton = document.getElementById("vibeSkip");
  const detectedEnergyLabel = document.getElementById("vibeDetectedEnergy");
  const playingRow = document.getElementById("vibePlayingRow");
  const playingEnergyLabel = document.getElementById("vibePlayingEnergy");

  const IDLE_HEIGHT = 5;
  const MAX_HEIGHT = 34;
  const STATE_LABELS = {
    quiet: "Quiet · 安靜沉著",
    social: "Social · 穩定交流",
    busy: "Busy · 尖峰活躍",
    transient: "Transient · 短暫事件",
    uncertain: "Uncertain · 等待確認",
  };
  const ENERGY_LABELS = { low: "Quiet", medium: "Social", high: "Busy" };
  const STATE_BY_ENERGY = { low: "quiet", medium: "social", high: "busy" };
  // Comfort/Balanced/Flow only diverge from each other once the room is
  // actually confirmed Busy (see context-engine.js) — in a quiet room they
  // all behave identically, which is easy to mistake for "these buttons
  // don't do anything." Spell out the intent so it's not invisible.
  const MODE_COPY = {
    comfort: "談話舒適優先：忙碌時只做最小音量補償，不追逐現場噪音。",
    balanced: "穩定與活力平衡：預設模式，依現場狀況適度調整音量與能量。",
    flow: "尖峰流動優先：忙碌時較積極提高音量，並更快切換到有活力的曲目。",
    manual: "手動控制：系統暫停自動判斷，改用「下一首」自行切換曲目類別。",
  };

  let active = false;
  let simTimer = null;
  let phase = 0;
  // The "candidate/confirming" and "playing track" rows only carry real
  // information when they diverge from the always-visible "目前狀態" row
  // (i.e. during a live transition, or the brief lag while the current
  // track finishes before the category actually switches). Otherwise all
  // three rows show the same Quiet/Social/Busy label and just look like
  // duplicate boxes, so they stay hidden until they say something new.
  let lastDetectedEnergyLabel = null;
  let lastPlayingEnergyLabel = null;

  function updatePlayingRowVisibility() {
    if (!playingRow) return;
    playingRow.hidden = !(
      lastDetectedEnergyLabel != null
      && lastPlayingEnergyLabel != null
      && lastPlayingEnergyLabel !== lastDetectedEnergyLabel
    );
  }

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

  function renderDecision(decision, context = {}) {
    if (!decision) return;
    // TRANSIENT_IGNORED/LOW_DATA_QUALITY are deliberately meant to be
    // invisible — context-engine.js holds the room state steady and doesn't
    // touch the music for these. But decision.energy is forced to "medium"
    // for both (it's neither "quiet" nor "busy"), which used to make the
    // status text flash to "Social" for that one frame before snapping back
    // — a real-feeling flicker every time a brief noise (a door, footsteps)
    // ticked past the transient threshold. Leave the display exactly as it
    // was instead of repainting it with a value nobody asked to see.
    if (decision.state === "transient" || decision.state === "uncertain") return;
    const rawCandidate = decision.candidateState || decision.state;
    const candidate = ["quiet", "social", "busy"].includes(rawCandidate)
      ? rawCandidate
      : STATE_BY_ENERGY[decision.energy] || "social";
    const candidateName = STATE_LABELS[candidate]?.split(" · ")[0] || candidate;
    const isConfirming = decision.reasonCode === "STATE_CONFIRMING";
    if (isConfirming) {
      status.textContent = `${candidateName} · ${decision.reason}`;
    } else {
      status.textContent = candidateName;
    }

    if (detectedEnergyLabel) {
      // Derive from the same candidateName as the status line above (not
      // ENERGY_LABELS[decision.energy]) so the two always agree. They can
      // otherwise diverge — e.g. Comfort mode deliberately keeps music
      // energy on Social even once the room is confirmed Busy — which read
      // as two contradictory boxes on screen. Any real divergence between
      // "room state" and "what's actually playing" still surfaces via the
      // existing #vibePlayingRow note below, driven by renderTrack().
      detectedEnergyLabel.textContent = candidateName;
      lastDetectedEnergyLabel = candidateName;
      updatePlayingRowVisibility();
    }
  }

  function renderTrack(meta, context = {}) {
    if (meta && trackLabel) {
      // meta.subtitle is always "{Quiet/Social/Busy} · {genre}" (see
      // soundscape-player.js's TRACKS data) — the energy word is already
      // shown in the 目前狀態 box above, so repeating it here just reads
      // as an unlabeled third "· something" segment. Show title + genre only.
      const genre = meta.subtitle?.split(" · ")[1] || meta.subtitle;
      trackLabel.textContent = genre ? `${meta.title} · ${genre}` : meta.title;
    }
    if (context.energy) {
      const playingLabel = ENERGY_LABELS[context.energy] || context.energy;
      if (playingEnergyLabel) playingEnergyLabel.textContent = playingLabel;
      lastPlayingEnergyLabel = playingLabel;
      updatePlayingRowVisibility();
    }
  }

  function setActiveMode(mode) {
    modeButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.vibeMode === mode);
    });
    if (modeCaption) modeCaption.textContent = MODE_COPY[mode] || "";
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
    status.textContent = "";
    meter.classList.add("is-active");

    try {
      if (window.VibeAudioEngine?.start) {
        const engineState = await window.VibeAudioEngine.start({
          onLevel: render,
          onDecision: renderDecision,
          onTrackChange: renderTrack,
        });
        setActiveMode(engineState.operationMode);
        status.textContent = "";
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
    if (detectedEnergyLabel) detectedEnergyLabel.textContent = "Social";
    if (playingRow) playingRow.hidden = true;
    if (playingEnergyLabel) playingEnergyLabel.textContent = "尚未播放";
    lastDetectedEnergyLabel = null;
    lastPlayingEnergyLabel = null;

    try {
      await window.VibeAudioEngine?.stop?.();
    } catch (error) {
      console.error("VibeAudioEngine.stop() failed; continuing cleanup", error);
    }
    stopSimulation();
    reset();
    window.dispatchEvent(new CustomEvent("vibespace:session-stop"));
  }

  toggle.addEventListener("click", () => {
    if (active) void stop();
    else void start();
  });

  window.addEventListener("pagehide", () => {
    if (active) void stop();
  });

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.dataset.vibeMode;
      window.VibeAudioEngine?.setOperationMode?.(mode);
      setActiveMode(mode);
    });
  });

  skipButton?.addEventListener("click", async () => {
    if (!active || skipButton.disabled) return;
    // Without this, impatient double-clicking can have two tracks briefly
    // audible at once while the first request is still resolving.
    skipButton.disabled = true;
    try {
      const meta = await window.VibeAudioEngine?.skipTrack?.();
      if (meta) renderTrack(meta);
    } finally {
      skipButton.disabled = false;
    }
  });

  modeDetailsToggle?.addEventListener("click", () => {
    if (!modeDetailsPanel) return;
    const expanded = !modeDetailsPanel.hidden;
    modeDetailsPanel.hidden = expanded;
    modeDetailsToggle.setAttribute("aria-expanded", String(!expanded));
    modeDetailsToggle.textContent = expanded ? "查看四種模式的差異 ▾" : "收起說明 ▴";
  });

  const initialConfiguration = window.VibeAudioEngine?.getConfiguration?.();
  if (initialConfiguration) {
    setActiveMode(initialConfiguration.operationMode);
    if (initialConfiguration.source === "manual") {
      status.textContent = "";
    }
  }
  reset();
})();


