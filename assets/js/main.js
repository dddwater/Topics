// Web Audio engine adapted from PR #4 for the delivery UI.
(() => {
  let audioContext = null;
  let analyser = null;
  let microphoneSource = null;
  let microphoneStream = null;
  let animationFrameId = null;
  let onLevel = null;
  let oscillator = null;
  let gainNode = null;
  let smoothedDominantFrequency = 0;
  let lastOscillatorUpdate = 0;

  const STORAGE_KEY = "vibespace.spaceSettings";
  const DEFAULT_PROFILE = {
    id: "automatic",
    name: "自動偵測",
    baseGain: 0.055,
    maxGain: 0.08,
    noiseSensitivity: 0.5,
    updateInterval: 400
  };
  let activeProfile = DEFAULT_PROFILE;
  let settingsSource = "automatic";

  function loadSavedProfile() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      const profile = saved?.acousticProfile;
      const validManualSettings = saved?.version === 2
        && saved?.source === "manual"
        && profile?.name
        && Number.isFinite(profile?.baseGain)
        && Number.isFinite(profile?.maxGain)
        && Number.isFinite(profile?.noiseSensitivity)
        && Number.isFinite(profile?.updateInterval);

      if (!validManualSettings) return null;
      return profile;
    } catch (error) {
      return null;
    }
  }

  function getConfiguration() {
    const savedProfile = loadSavedProfile();
    return {
      source: savedProfile ? "manual" : "automatic",
      profile: savedProfile || DEFAULT_PROFILE
    };
  }

  function getDominantFrequency() {
    const frequencyData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(frequencyData);

    let maxMagnitude = 0;
    let maxIndex = 0;
    frequencyData.forEach((magnitude, index) => {
      if (magnitude > maxMagnitude) {
        maxMagnitude = magnitude;
        maxIndex = index;
      }
    });

    return maxIndex > 0
      ? (maxIndex * audioContext.sampleRate) / analyser.fftSize
      : 0;
  }

  function quantizeToPentatonicScale(frequency) {
    if (!frequency || frequency <= 0) return 0;

    const majorPentatonic = [0, 2, 4, 7, 9];
    const rootMidi = 57;
    const midi = 69 + 12 * Math.log2(frequency / 440);
    let closestMidi = rootMidi;
    let closestDistance = Infinity;

    for (let octave = -4; octave <= 4; octave += 1) {
      majorPentatonic.forEach((semitone) => {
        const candidate = rootMidi + octave * 12 + semitone;
        const distance = Math.abs(candidate - midi);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestMidi = candidate;
        }
      });
    }

    return 440 * 2 ** ((closestMidi - 69) / 12);
  }

  function readMicrophone() {
    if (!analyser || !audioContext) return;

    const samples = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(samples);
    let sum = 0;

    samples.forEach((sample) => {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    });

    const rms = Math.sqrt(sum / samples.length);
    const dominantFrequency = getDominantFrequency();
    const quantizedFrequency = quantizeToPentatonicScale(dominantFrequency);

    if (dominantFrequency > 0) {
      smoothedDominantFrequency +=
        (dominantFrequency - smoothedDominantFrequency) * 0.12;
    }

    const now = Date.now();
    if (
      oscillator &&
      smoothedDominantFrequency > 0 &&
      now - lastOscillatorUpdate >= activeProfile.updateInterval
    ) {
      const targetFrequency = Math.min(
        Math.max(quantizeToPentatonicScale(smoothedDominantFrequency), 40),
        5000
      );
      oscillator.frequency.setTargetAtTime(
        targetFrequency,
        audioContext.currentTime,
        0.06
      );
      lastOscillatorUpdate = now;
    }

    if (gainNode) {
      const targetGain = Math.min(
        activeProfile.maxGain,
        Math.max(0.015, activeProfile.baseGain - rms * activeProfile.noiseSensitivity)
      );
      gainNode.gain.setTargetAtTime(targetGain, audioContext.currentTime, 0.12);
    }

    onLevel?.(Math.min(1, rms * 8), {
      rms,
      dominantFrequency,
      quantizedFrequency,
    });

    animationFrameId = requestAnimationFrame(readMicrophone);
  }

  async function start(options = {}) {
    if (microphoneStream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("此瀏覽器不支援麥克風輸入");
    }

    onLevel = options.onLevel;
    const configuration = getConfiguration();
    activeProfile = configuration.profile;
    settingsSource = configuration.source;
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") await audioContext.resume();

    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    microphoneSource = audioContext.createMediaStreamSource(microphoneStream);
    microphoneSource.connect(analyser);

    gainNode = audioContext.createGain();
    gainNode.gain.value = activeProfile.baseGain;
    gainNode.connect(audioContext.destination);
    oscillator = audioContext.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = 220;
    oscillator.connect(gainNode);
    oscillator.start();

    smoothedDominantFrequency = 0;
    lastOscillatorUpdate = 0;
    readMicrophone();
    return { source: settingsSource, profileName: activeProfile.name };
  }

  function stop() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    microphoneSource?.disconnect();
    microphoneSource = null;
    microphoneStream?.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
    if (oscillator) {
      oscillator.stop();
      oscillator.disconnect();
    }
    oscillator = null;
    gainNode?.disconnect();
    gainNode = null;
    analyser = null;
    onLevel = null;
  }

  window.VibeAudioEngine = { start, stop, getConfiguration };
  window.addEventListener("pagehide", stop);
})();

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

  async function start() {
    active = true;
    toggle.disabled = true;
    toggle.setAttribute("aria-pressed", "true");
    label.textContent = "停止";
    status.textContent = "聆聽環境音量中";
    meter.classList.add("is-active");

    try {
      if (window.VibeAudioEngine?.start) {
        const engineState = await window.VibeAudioEngine.start({ onLevel: render });
        status.textContent = engineState?.source === "manual"
          ? `已套用「${engineState.profileName}」・聆聽環境中`
          : "自動偵測中・聆聽環境音量";
      } else {
        startSimulation();
      }
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

  toggle.addEventListener("click", () => {
    if (active) stop();
    else start();
  });
  const initialConfiguration = window.VibeAudioEngine?.getConfiguration?.();
  if (initialConfiguration?.source === "manual") {
    status.textContent = `已準備「${initialConfiguration.profile.name}」手動設定`;
  }
  reset();
})();
