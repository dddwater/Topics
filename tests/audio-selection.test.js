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

// A fire-and-forget async chain (e.g. an "ended" event handler kicking off
// selectRandomTrack -> player.setTrack -> audio.play()) resolves over several
// microtask turns, and a fixed-count `await Promise.resolve()` loop is only
// as deep as its count — flaky if the real chain is deeper. A macrotask
// boundary is a hard guarantee instead: Node always fully drains the
// microtask queue before running the next timer, however deep the chain.
async function flushMicrotasks() {
  await new Promise((resolve) => { setTimeout(resolve, 0); });
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

  // "medium" index 4 (calm-loop.mp3) is the only track flagged `loop: true`
  // (a genuine ~19s ambient bed). Only loop-flagged tracks replay in place;
  // regular full-length songs play once and move on (see below).
  let completed = null;
  const player = new api.SoundscapePlayer({ random: () => 0, onTrackCycleComplete: (event) => { completed = event; } });
  await player.play("medium", -24, 4);
  player.active.audio.listeners.ended();
  assert.equal(completed, null, "loop-flagged track must replay after the first ending");
  player.active.audio.listeners.ended();
  assert.equal(completed.loops, 2);
  await player.destroy();

  const threeLoopPlayer = new api.SoundscapePlayer({ random: () => 0.999, onTrackCycleComplete: (event) => { completed = event; } });
  completed = null;
  await threeLoopPlayer.play("medium", -24, 4);
  threeLoopPlayer.active.audio.listeners.ended();
  threeLoopPlayer.active.audio.listeners.ended();
  assert.equal(completed, null);
  threeLoopPlayer.active.audio.listeners.ended();
  assert.equal(completed.loops, 3);
  await threeLoopPlayer.destroy();

  let regularCompleted = null;
  const regularPlayer = new api.SoundscapePlayer({ random: () => 0.999, onTrackCycleComplete: (event) => { regularCompleted = event; } });
  await regularPlayer.play("high", -24, 0);
  regularPlayer.active.audio.listeners.ended();
  assert.equal(regularCompleted?.loops, 1, "a regular (non-loop) track must move on after a single play, not repeat");
  await regularPlayer.destroy();

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
    VibeSpaceAuth: { getSession: async () => ({ user: { id: "test-user" } }) },
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

// Regression test for a bug where main.js always passed a hardcoded
// dataQuality: 0.94 to decideContext(), so context-engine.js's
// LOW_DATA_QUALITY safety hold could never trigger no matter how bad the mic
// signal was. Drives the real assets/js/main.js engine end-to-end to prove a
// muted mic track now actually holds decisions instead of trusting it.
async function testLowDataQualityHold() {
  class MockAudio {
    constructor(src) { this.src = src; this.listeners = {}; this.paused = true; }
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
    constructor() { this.fftSize = 2048; this.sample = 10 ** (-30 / 20); }
    getFloatTimeDomainData(array) { array.fill(this.sample); }
  }
  class MockAudioContext {
    constructor() {
      this.state = "running";
      this.destination = {};
      this.analyser = new MockAnalyser();
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
  const micTrack = { readyState: "live", muted: false, stop() {} };
  const navigatorMock = {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [micTrack] }) },
  };
  const storage = new Map();
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  let rafCallback = null;
  const requestAnimationFrame = (callback) => { rafCallback = callback; return 1; };
  const cancelAnimationFrame = () => { rafCallback = null; };

  const window = {
    AudioContext: MockAudioContext,
    VibeSpaceAuth: { getSession: async () => ({ user: { id: "test-user" } }) },
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
    Date,
    Audio: MockAudio,
    CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } },
    requestAnimationFrame,
    cancelAnimationFrame,
  });

  let lastDecision = null;
  await window.VibeAudioEngine.start({ onDecision: (decision) => { lastDecision = decision; } });
  rafCallback();
  assert.notEqual(lastDecision.reasonCode, "LOW_DATA_QUALITY", "a healthy live track must not be treated as low quality");

  micTrack.muted = true;
  rafCallback();
  assert.equal(lastDecision.reasonCode, "LOW_DATA_QUALITY", "a muted mic track must hold decisions instead of trusting the signal");

  await window.VibeAudioEngine.stop();
}

// Regression test for a bug where main.js updated latestDecisionEnergy from
// decision.energy on every tick with no guard for the transient/uncertain
// pseudo-states — unlike currentState, which is correctly shielded. Since
// context-engine.js forces energy to "medium" for a TRANSIENT_IGNORED tick
// regardless of the real sustained state, a transient noise spike landing on
// the same tick as a track's natural "ended" event could snap the category
// down even though the volume/currentState logic correctly ignored the spike.
// Drives the real assets/js/main.js engine end-to-end to prove a transient
// spike can no longer influence which category the next track is drawn from.
async function testTransientSpikeDoesNotSwitchCategory() {
  const audioInstances = [];
  class MockAudio {
    constructor(src) { this.src = src; this.listeners = {}; this.paused = true; audioInstances.push(this); }
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
  let rafCallback = null;
  const requestAnimationFrame = (callback) => { rafCallback = callback; return 1; };
  const cancelAnimationFrame = () => { rafCallback = null; };
  let clock = 1_700_000_000_000;
  const DateMock = { now: () => clock };

  const window = {
    AudioContext: MockAudioContext,
    VibeSpaceAuth: { getSession: async () => ({ user: { id: "test-user" } }) },
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
  const trackChanges = [];
  await window.VibeAudioEngine.start({
    onDecision: (decision) => { lastDecision = decision; },
    onTrackChange: (meta, context) => { trackChanges.push(context); },
  });

  // main.js builds its mic AudioContext before SoundscapePlayer.play() builds
  // its own playback AudioContext, so the first instance is the mic analyser.
  const micAnalyser = contextInstances[0].analyser;
  const setLevelDb = (dbRel) => { micAnalyser.sample = 10 ** (dbRel / 20); };
  const tick = () => { clock += 100; rafCallback(); };

  // Confirm a sustained "busy" state so the ambient decision engine reaches
  // energy "high", then let the currently-playing "medium" track hit its own
  // boundary so playback actually switches up to a "high" track (matching
  // the documented "don't interrupt the current play-through" rule).
  setLevelDb(-28);
  for (let i = 0; i < 300 && lastDecision?.state !== "busy"; i += 1) tick();
  assert.equal(lastDecision.state, "busy");
  assert.equal(lastDecision.energy, "high");
  trackChanges.length = 0;
  audioInstances.at(-1).listeners.ended();
  await flushMicrotasks();
  assert.equal(trackChanges.at(-1)?.energy, "high", "track must have switched up to Busy at the boundary");

  // Now inject a single dramatic transient spike on top of the sustained busy
  // level (loud enough to trip TRANSIENT_IGNORED but not so loud it trips the
  // separate clipping/LOW_DATA_QUALITY check), then simulate the (now Busy)
  // track's natural "ended" event landing on that exact tick — the real-world
  // race this bug depended on.
  setLevelDb(-12);
  tick();
  assert.equal(lastDecision.reasonCode, "TRANSIENT_IGNORED", "this tick must be recognized as a transient spike");
  trackChanges.length = 0;
  audioInstances.at(-1).listeners.ended();
  await flushMicrotasks();

  assert.equal(
    trackChanges.at(-1)?.energy,
    "high",
    "a transient spike coinciding with a track boundary must not be able to switch the category away from Busy",
  );

  await window.VibeAudioEngine.stop();
}

// Regression test for a bug where handleTrackCycleComplete had no Manual-mode
// guard (unlike handleTrackEnded, which does), so once a track finished its
// loop cycle while Manual was engaged, main.js would still pick the next
// track's category off latestDecisionEnergy — silently violating "Manual
// mode 曲風都不會自動變化" whenever the ambient decision (frozen from before
// Manual was engaged) disagreed with the category actually still playing.
// Drives the real assets/js/main.js engine end-to-end to prove Manual mode
// now keeps playback within the same category instead of auto-switching.
async function testManualModeDoesNotAutoSwitchCategoryOnCycleComplete() {
  const audioInstances = [];
  class MockAudio {
    constructor(src) { this.src = src; this.listeners = {}; this.paused = true; audioInstances.push(this); }
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
  let rafCallback = null;
  const requestAnimationFrame = (callback) => { rafCallback = callback; return 1; };
  const cancelAnimationFrame = () => { rafCallback = null; };
  let clock = 1_700_000_000_000;
  const DateMock = { now: () => clock };

  const window = {
    AudioContext: MockAudioContext,
    VibeSpaceAuth: { getSession: async () => ({ user: { id: "test-user" } }) },
    dispatchEvent() {},
    addEventListener() {},
  };

  // Both NonRepeatingTrackSelector and SoundscapePlayer fall back to the real
  // Math.random when not given one explicitly, and neither is reachable from
  // this test to inject a deterministic one — main.js constructs its
  // trackSelector at module-load time (loadScript below), so this has to be
  // patched *before* loadScript runs, not just before start(). Pin it to 0
  // (always picks the first available choice) so track selection never lands
  // on medium index 4 ("Calm Loop", the one loop:true track — loopGoal 2-3),
  // which would make a single "ended" event replay instead of completing the
  // cycle this test depends on.
  const originalRandom = Math.random;
  Math.random = () => 0;

  let lastDecision = null;
  const trackChanges = [];
  try {
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

    await window.VibeAudioEngine.start({
      onDecision: (decision) => { lastDecision = decision; },
      onTrackChange: (meta, context) => { trackChanges.push(context); },
    });

    const micAnalyser = contextInstances[0].analyser;
    const setLevelDb = (dbRel) => { micAnalyser.sample = 10 ** (dbRel / 20); };
    const tick = () => { clock += 100; rafCallback(); };

    // Confirm a sustained "busy" state (energy "high") while the initial
    // "medium" track is still playing — the ambient engine has decided Busy,
    // but per the "don't interrupt the current play-through" rule the track
    // itself hasn't switched up yet. This is exactly the divergence between
    // latestDecisionEnergy ("high") and the actively-playing category
    // ("medium") that the bug needed to be observable.
    setLevelDb(-28);
    for (let i = 0; i < 300 && lastDecision?.state !== "busy"; i += 1) tick();
    assert.equal(lastDecision.state, "busy");
    assert.equal(lastDecision.energy, "high");
    assert.equal(trackChanges.length, 1, "the still-playing initial track must not have switched yet");
    assert.equal(trackChanges[0].energy, "medium");

    // Engage Manual mode now, before the still-Medium track reaches its own
    // boundary.
    window.VibeAudioEngine.setOperationMode("manual");
    tick();
    assert.equal(lastDecision.reasonCode, "MANUAL_HOLD");

    // Let the still-playing Medium track finish its (single, non-loop) cycle.
    trackChanges.length = 0;
    audioInstances.at(-1).listeners.ended();
    await flushMicrotasks();

    assert.equal(trackChanges.length, 1, "playback must continue, not go silent, once Manual's current track ends");
    assert.equal(
      trackChanges[0].energy,
      "medium",
      "Manual mode must never auto-switch category, even when latestDecisionEnergy disagrees with what's playing",
    );

    await window.VibeAudioEngine.stop();
  } finally {
    Math.random = originalRandom;
  }
}

// Regression test for a bug where start() had no cleanup on failure: if the
// initial player.play() rejected (e.g. an autoplay-policy rejection), the
// already-acquired mic stream and AudioContext were left dangling, and the
// `if (microphoneStream) return;` guard at the top of start() then made every
// subsequent retry silently no-op instead of actually retrying.
async function testStartCleansUpAfterPlayFailure() {
  let playAttempt = 0;
  class MockAudio {
    constructor(src) { this.src = src; this.listeners = {}; this.paused = true; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    removeEventListener() {}
    play() {
      playAttempt += 1;
      if (playAttempt === 1) return Promise.reject(new Error("NotAllowedError"));
      this.paused = false;
      return Promise.resolve();
    }
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
  let micStopCalls = 0;
  const micTrack = { readyState: "live", muted: false, stop() { micStopCalls += 1; } };
  const navigatorMock = {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [micTrack] }) },
  };
  const storage = new Map();
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  let rafCallback = null;
  const requestAnimationFrame = (callback) => { rafCallback = callback; return 1; };
  const cancelAnimationFrame = () => { rafCallback = null; };

  const window = {
    AudioContext: MockAudioContext,
    VibeSpaceAuth: { getSession: async () => ({ user: { id: "test-user" } }) },
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
    Date,
    Audio: MockAudio,
    CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } },
    requestAnimationFrame,
    cancelAnimationFrame,
  });

  await assert.rejects(() => window.VibeAudioEngine.start({}), /NotAllowedError/);
  assert.equal(micStopCalls, 1, "the mic track must be stopped after a failed start");
  assert.equal(contextInstances[0].state, "closed", "the mic AudioContext must be closed after a failed start");

  // A second attempt must actually retry (not silently no-op because
  // microphoneStream was left set from the failed attempt).
  const engineState = await window.VibeAudioEngine.start({});
  assert.ok(engineState, "a second start() attempt must succeed once cleanup has run");

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
  await testLowDataQualityHold();
  await testTransientSpikeDoesNotSwitchCategory();
  await testManualModeDoesNotAutoSwitchCategoryOnCycleComplete();
  await testStartCleansUpAfterPlayFailure();
  await testLibraryAndLoopCount();
  await testFreesoundFiltersAndSnapshot();
  testDetectionDiagnosticsMarkup();
  console.log("audio selection tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


