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
  for (const id of ["vibeCandidate", "vibeConfirmation", "vibeDetectedEnergy", "vibePlayingEnergy"]) {
    assert.match(index, new RegExp(`id=["']${id}["']`), `${id} should be visible on the player page`);
  }
  assert.match(index, /main\.js\?v=candidate-status-3/, "main.js cache key should be refreshed");
  assert.match(index, /main\.css\?v=logout-button-2/, "main.css cache key should be refreshed");
}

(async () => {
  await testSelector();
  await testCandidateStateConfirmation();
  await testLibraryAndLoopCount();
  await testFreesoundFiltersAndSnapshot();
  testDetectionDiagnosticsMarkup();
  console.log("audio selection tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


