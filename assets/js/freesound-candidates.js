(() => {
  "use strict";

  const API_BASE = "https://freesound.org/apiv2/search/";
  const CACHE_KEY = "vibespace.freesoundCandidates.v1";
  const SNAPSHOT_KEY = "vibespace.freesoundLicenseSnapshots.v1";
  const QUERY_BY_ENERGY = {
    low: "lofi calm ambient relaxing music",
    medium: "chill jazz lounge social music",
    high: "funk groove upbeat music",
  };

  function getApiToken() {
    return String(window.VIBESPACE_FREESOUND_API_KEY || "").trim();
  }

  function isAcceptedCandidate(sound) {
    const preview = sound?.previews?.["preview-hq-mp3"] || sound?.previews?.["preview-lq-mp3"];
    return sound?.license === "Creative Commons 0"
      && Number(sound?.duration) >= 60
      && Boolean(preview);
  }

  function normalizeCandidate(sound, energy) {
    return {
      provider: "Freesound",
      providerId: sound.id,
      energy,
      title: sound.name,
      artist: sound.username,
      duration: Number(sound.duration),
      license: sound.license,
      sourceUrl: sound.url,
      previewUrl: sound.previews["preview-hq-mp3"] || sound.previews["preview-lq-mp3"],
      tags: Array.isArray(sound.tags) ? sound.tags : [],
      fetchedAt: new Date().toISOString(),
      status: "candidate",
    };
  }

  async function searchCandidates(energy, options = {}) {
    const token = options.token || getApiToken();
    if (!token) return [];
    const params = new URLSearchParams({
      query: QUERY_BY_ENERGY[energy],
      filter: 'license:"Creative Commons 0" category:Music duration:[60 TO *]',
      fields: "id,name,username,license,duration,previews,url,tags,type",
      page_size: String(options.limit || 12),
      sort: "rating_desc",
    });
    const response = await fetch(`${API_BASE}?${params}`, {
      headers: { Authorization: `Token ${token}` },
    });
    if (!response.ok) throw new Error(`Freesound API ${response.status}`);
    const payload = await response.json();
    const candidates = (payload.results || [])
      .filter(isAcceptedCandidate)
      .map((sound) => normalizeCandidate(sound, energy));
    saveCandidateCache(energy, candidates);
    return candidates;
  }

  function saveCandidateCache(energy, candidates) {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
      cache[energy] = { fetchedAt: new Date().toISOString(), candidates };
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
      // Candidate discovery remains optional when storage is unavailable.
    }
  }

  function saveLicenseSnapshot(candidate) {
    if (!isAcceptedCandidate({
      license: candidate?.license,
      duration: candidate?.duration,
      previews: { "preview-hq-mp3": candidate?.previewUrl },
    })) {
      throw new Error("候選歌曲不符合 CC0、60 秒及可播放預覽規範");
    }
    const snapshot = {
      provider: candidate.provider,
      providerId: candidate.providerId,
      energy: candidate.energy,
      title: candidate.title,
      artist: candidate.artist,
      sourceUrl: candidate.sourceUrl,
      previewUrl: candidate.previewUrl,
      duration: candidate.duration,
      license: candidate.license,
      capturedAt: new Date().toISOString(),
      status: "reviewed-before-download",
    };
    const snapshots = JSON.parse(localStorage.getItem(SNAPSHOT_KEY)) || [];
    snapshots.push(snapshot);
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots));
    return snapshot;
  }

  async function refreshAll() {
    if (!getApiToken()) return { enabled: false, candidates: {} };
    const entries = await Promise.all(
      Object.keys(QUERY_BY_ENERGY).map(async (energy) => [energy, await searchCandidates(energy)]),
    );
    return { enabled: true, candidates: Object.fromEntries(entries) };
  }

  window.VibeSpaceFreesound = {
    getApiToken,
    isAcceptedCandidate,
    searchCandidates,
    refreshAll,
    saveLicenseSnapshot,
  };
})();
