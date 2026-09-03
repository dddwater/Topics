const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");

function loadScript(file, extras = {}) {
  const window = extras.window || {};
  const context = vm.createContext({
    window,
    console,
    Date,
    Math,
    URLSearchParams,
    ...extras,
  });
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  return window;
}

async function testSelector() {
  const window = loadScript("assets/js/track-selector.js");
  const { NonRepeatingTrackSelector } = window.VibeSpaceTrackSelection;
  const values = [0, 0, 0, 0];
  const selector = new NonRepeatingTrackSelector(() => 5, { random: () => values.shift() || 0, historySize: 2 });
  const picks = [];
  for (let index = 0; index < 4; index += 1) picks.push(selector.next("low", picks.at(-1) ?? null));
  assert.deepEqual(picks, [0, 1, 2, 0]);
  assert.equal(selector.next("medium", null), 0, "histories must stay category-specific");
}

async function testLibraryAndLoopCount() {
  const audioInstances = [];
  class MockAudio {
    constructor(src) {
      this.src = src;
      this.listeners = {};
      this.playCount = 0;
      this.paused = true;
      audioInstances.push(this);
    }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    removeEventListener(name) { delete this.listeners[name]; }
    play() { this.playCount += 1; this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const node = () => ({
    gain: { value: 1, setValueAtTime() {}, cancelScheduledValues() {}, exponentialRampToValueAtTime() {}, setValueCurveAtTime() {} },
    connect() { return this; },
    disconnect() {},
  });
  class MockContext {
    constructor() { this.currentTime = 0; this.state = "running"; this.destination = {}; }
    createGain() { return node(); }
    createDynamicsCompressor() { return { ...node(), threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} }; }
    createMediaElementSource() { return node(); }
    resume() { return Promise.resolve(); }
    close() { this.state = "closed"; return Promise.resolve(); }
  }
  const browserWindow = { AudioContext: MockContext, setTimeout, clearTimeout };
  const window = loadScript("assets/js/soundscape-player.js", { window: browserWindow, Audio: MockAudio });
  const api = window.VibeSpaceSoundscape;
  for (const energy of ["low", "medium", "high"]) {
    assert.equal(api.getSoundscapeTrackCount(energy), 5);
    for (let index = 0; index < 5; index += 1) {
      const file = api.getSoundscapeMeta(energy, index).src;
      assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
    }
  }

  let completed = null;
  const player = new api.SoundscapePlayer({ random: () => 0, onTrackCycleComplete: (event) => { completed = event; } });
  await player.play("low", -24, 0);
  player.active.audio.listeners.ended();
  assert.equal(completed, null, "two-loop track must replay after the first ending");
  player.active.audio.listeners.ended();
  assert.equal(completed.loops, 2);
  await player.destroy();

  const threeLoopPlayer = new api.SoundscapePlayer({ random: () => 0.999, onTrackCycleComplete: (event) => { completed = event; } });
  completed = null;
  await threeLoopPlayer.play("high", -24, 0);
  threeLoopPlayer.active.audio.listeners.ended();
  threeLoopPlayer.active.audio.listeners.ended();
  assert.equal(completed, null);
  threeLoopPlayer.active.audio.listeners.ended();
  assert.equal(completed.loops, 3);
  await threeLoopPlayer.destroy();

  const singleTrackPlayer = new api.SoundscapePlayer({ random: () => 0 });
  await singleTrackPlayer.play("medium", -24, 0);
  await singleTrackPlayer.setTrack("medium", 1);
  await singleTrackPlayer.setTrack("high", 2);
  assert.equal(singleTrackPlayer.activeEnergy, "high");
  assert.equal(singleTrackPlayer.activeTrackIndex, 2);
  assert.equal(
    audioInstances.filter((audio) => !audio.paused).length,
    1,
    "rapid track changes must leave exactly one audio element playing",
  );
  await singleTrackPlayer.destroy();

  let categoryChanged = false;
  let boundaryEvent = null;
  const boundaryPlayer = new api.SoundscapePlayer({
    random: () => 0.999,
    onTrackEnded: (event) => {
      boundaryEvent = event;
      if (event.energy !== "medium") return false;
      categoryChanged = true;
      return true;
    },
  });
  await boundaryPlayer.play("medium", -24, 0);
  boundaryPlayer.active.audio.listeners.ended();
  assert.equal(categoryChanged, true, "environment change must be handled after the current play ends");
  assert.equal(boundaryEvent.loops, 1);
  assert.equal(boundaryPlayer.active.audio.playCount, 1, "old category must not start another loop");
  await boundaryPlayer.destroy();
}

async function testCandidateStateConfirmation() {
  const window = loadScript("assets/js/context-engine.js");
  const { decideContext, DEFAULT_CALIBRATION } = window.VibeSpaceContextEngine;
  const base = {
    shortTermDbRel: -50,
    longTermDbRel: -50,
    transientScore: 0,
    dataQuality: 0.94,
    sustainedSeconds: 120,
    currentState: "social",
    currentGainDb: DEFAULT_CALIBRATION.preferredGainDb,
    operationMode: "balanced",
    calibration: DEFAULT_CALIBRATION,
    canChangeTrack: true,
    manualHold: false,
  };

  const firstQuiet = decideContext({ ...base, candidateState: "social", candidateSeconds: 60 });
  assert.equal(firstQuiet.state, "social");
  assert.equal(firstQuiet.candidateState, "quiet");
  assert.equal(firstQuiet.candidateSeconds, 0, "a new candidate must start its own timer");
  assert.equal(firstQuiet.reason, "空間轉靜尚在確認中（0 / 10 秒）");

  const confirmingQuiet = decideContext({ ...base, candidateState: "quiet", candidateSeconds: 9 });
  assert.equal(confirmingQuiet.state, "social");
  assert.equal(confirmingQuiet.reasonCode, "STATE_CONFIRMING");

  const confirmedQuiet = decideContext({ ...base, candidateState: "quiet", candidateSeconds: 10 });
  assert.equal(confirmedQuiet.state, "quiet");
  assert.equal(confirmedQuiet.energy, "low");

  const confirmedBusy = decideContext({
    ...base,
    shortTermDbRel: -28,
    longTermDbRel: -28,
    candidateState: "busy",
    candidateSeconds: 10,
  });
  assert.equal(confirmedBusy.state, "busy");
  assert.equal(confirmedBusy.energy, "high");

  const confirmingBusy = decideContext({
    ...base,
    shortTermDbRel: -28,
    longTermDbRel: -28,
    candidateState: "busy",
    candidateSeconds: 9,
  });
  assert.equal(confirmingBusy.reason, "活動升高尚在確認中（9 / 10 秒）");

  const confirmingSocial = decideContext({
    ...base,
    shortTermDbRel: -36,
    longTermDbRel: -36,
    currentState: "quiet",
    candidateState: "social",
    candidateSeconds: 9,
  });
  assert.equal(confirmingSocial.reasonCode, "STATE_CONFIRMING");
  assert.equal(confirmingSocial.reason, "活動升高尚在確認中（9 / 10 秒）");

  const confirmedSocial = decideContext({
    ...base,
    shortTermDbRel: -36,
    longTermDbRel: -36,
    currentState: "quiet",
    candidateState: "social",
    candidateSeconds: 10,
  });
  assert.equal(confirmedSocial.state, "social");

  const comfortBusy = decideContext({ ...base, ...confirmedBusy, operationMode: "comfort" });
  assert.equal(comfortBusy.energy, "medium", "Comfort intentionally keeps busy rooms on Social energy");
}

// Regression test for a bug where main.js's candidate-confirmation timer kept
// counting real wall-clock time while parked in Manual mode (decideContext
// short-circuits to MANUAL_HOLD before ever touching the candidate tracker).
// Leaving Manual with a pending-but-unconfirmed candidate from before Manual
// was engaged would instantly "confirm" it off stale elapsed time instead of
// requiring a fresh confirmation window. This drives the real assets/js/main.js
// engine end-to-end (mocked mic/audio/DOM/clock) to prove the fix holds.
async function testManualModeDoesNotSnapOnExit() {
  class MockAudio {
    constructor(src) {
      this.src = src;
      this.listeners = {};
      this.paused = true;
    }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    removeEventListener() {}
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const node = () => ({
    gain: { value: 1, setValueAtTime() {}, cancelScheduledValues() {}, exponentialRampToValueAtTime() {} },
    connect() { return this; },
    disconnect() {},
  });
  class MockAnalyser {
    constructor() { this.fftSize = 2048; this.sample = 0; }
    getFloatTimeDomainData(array) { array.fill(this.sample); }
  }
  const contextInstances = [];
  class MockAudioContext {
    constructor() {
      this.state = "running";
      this.destination = {};
      this.analyser = new MockAnalyser();
      contextInstances.push(this);
    }
    createAnalyser() { return this.analyser; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createMediaElementSource() { return { connect() { return this; }, disconnect() {} }; }
    createGain() { return node(); }
    createDynamicsCompressor() { return { ...node(), threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} }; }
    resume() { return Promise.resolve(); }
    close() { this.state = "closed"; return Promise.resolve(); }
  }

  function makeFakeElement() {
    return {
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {},
      removeEventListener() {},
      setAttribute() {},
      textContent: "",
    };
  }
  const documentMock = {
    getElementById: () => makeFakeElement(),
    querySelector: () => makeFakeElement(),
    querySelectorAll: () => [],
  };
  const navigatorMock = {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
  };
  const storage = new Map();
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  let clock = 1_700_000_000_000;
  const DateMock = { now: () => clock };
  let rafCallback = null;
  const requestAnimationFrame = (callback) => { rafCallback = callback; return 1; };
  const cancelAnimationFrame = () => { rafCallback = null; };

  const window = {
    AudioContext: MockAudioContext,
    dispatchEvent() {},
    addEventListener() {},
  };
  loadScript("assets/js/context-engine.js", { window });
  loadScript("assets/js/track-selector.js", { window });
  loadScript("assets/js/soundscape-player.js", { window, Audio: MockAudio });
  loadScript("assets/js/main.js", {
    window,
    document: documentMock,
    navigator: navigatorMock,
    localStorage,
    Date: DateMock,
    Audio: MockAudio,
    CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } },
    requestAnimationFrame,
    cancelAnimationFrame,
  });

  let lastDecision = null;
  await window.VibeAudioEngine.start({ onDecision: (decision) => { lastDecision = decision; } });

  // main.js builds its mic AudioContext before SoundscapePlayer.play() builds
  // its own playback AudioContext, so the first instance is the mic analyser.
  const micAnalyser = contextInstances[0].analyser;
  const setLevelDb = (dbRel) => { micAnalyser.sample = 10 ** (dbRel / 20); };
  const tick = () => rafCallback();

  // Drive the smoothed long-term level up to a sustained "busy" reading while
  // still in Balanced mode, until the engine starts confirming a busy candidate.
  setLevelDb(-30);
  for (let i = 0; i < 200 && lastDecision?.reasonCode !== "STATE_CONFIRMING"; i += 1) tick();
  assert.equal(lastDecision.reasonCode, "STATE_CONFIRMING", "should be confirming a busy candidate");
  assert.equal(lastDecision.candidateState, "busy");
  assert.equal(lastDecision.state, "social", "must not have switched yet");

  // Flip to Manual mid-confirmation, then let a lot of real time pass while
  // parked there (still reading busy-level noise in the background).
  window.VibeAudioEngine.setOperationMode("manual");
  tick();
  clock += 30_000;
  tick();

  // Exit Manual with the same busy-level reading still pending. Without the
  // fix this instantly reports state "busy" off the 30s-stale timer.
  window.VibeAudioEngine.setOperationMode("balanced");
  tick();
  assert.notEqual(lastDecision.state, "busy", "must not snap to busy off a stale pre-Manual timer");
  assert.equal(lastDecision.reasonCode, "STATE_CONFIRMING", "must require a fresh confirmation window");
  assert.ok(lastDecision.candidateSeconds < 1, "confirmation timer must have restarted near zero");

  // A genuine fresh 10s confirmation window after exiting should still work.
  clock += 10_000;
  tick();
  assert.equal(lastDecision.state, "busy", "should confirm busy after a real post-Manual window");

  await window.VibeAudioEngine.stop();
}

async function testFreesoundFiltersAndSnapshot() {
  const storage = new Map();
  const localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
  };
  const base = {
    id: 1, name: "Valid", username: "Artist", license: "Creative Commons 0",
    duration: 61, url: "https://freesound.org/s/1", tags: ["music"],
    previews: { "preview-hq-mp3": "https://cdn.example/1.mp3" },
  };
  let requestedUrl = "";
  const fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({ results: [
        base,
        { ...base, id: 2, license: "Attribution" },
        { ...base, id: 3, duration: 59 },
        { ...base, id: 4, previews: {} },
      ] }),
    };
  };
  const window = loadScript("assets/js/freesound-candidates.js", {
    window: { VIBESPACE_FREESOUND_API_KEY: "" }, localStorage, fetch,
  });
  const api = window.VibeSpaceFreesound;
  const candidates = await api.searchCandidates("low", { token: "test-token" });
  assert.equal(candidates.length, 1);
  const requestedFilter = new URL(requestedUrl).searchParams.get("filter");
  assert.match(requestedFilter, /category:Music/);
  assert.match(requestedFilter, /duration:\[60 TO \*\]/);
  const snapshot = api.saveLicenseSnapshot(candidates[0]);
  assert.equal(snapshot.artist, "Artist");
  assert.equal(snapshot.license, "Creative Commons 0");
  assert.equal(snapshot.status, "reviewed-before-download");
  assert.throws(() => api.saveLicenseSnapshot({ ...candidates[0], license: "Attribution" }));
}

function testDetectionDiagnosticsMarkup() {
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  // vibeCandidate/vibeConfirmation were removed: during STATE_CONFIRMING the
  // status line's decision.reason already spells out the same candidate +
  // countdown in prose (e.g. "Quiet · 空間轉靜尚在確認中（7 / 10 秒）"), so
  // the separate 偵測中/確認倒數 stat boxes were showing the same two facts
  // twice. 目前狀態/播放曲目 stay since they're the diagnostics box's only
  // remaining, non-redundant content.
  for (const id of ["vibeDetectedEnergy", "vibePlayingEnergy"]) {
    assert.match(index, new RegExp(`id=["']${id}["']`), `${id} should be visible on the player page`);
  }
  assert.doesNotMatch(index, /id=["']vibeCandidate["']/, "candidate row should stay removed (redundant with the status line)");
  assert.doesNotMatch(index, /id=["']vibeConfirmation["']/, "confirmation row should stay removed (redundant with the status line)");
  assert.match(index, /main\.js\?v=status-line-dedup-1/, "main.js cache key should be refreshed");
  assert.match(index, /main\.css\?v=status-line-dedup-1/, "main.css cache key should be refreshed");
}

(async () => {
  await testSelector();
  await testCandidateStateConfirmation();
  await testManualModeDoesNotSnapOnExit();
  await testLibraryAndLoopCount();
  await testFreesoundFiltersAndSnapshot();
  testDetectionDiagnosticsMarkup();
  console.log("audio selection tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


