// Crossfading soundscape player, ported from emma63194/vibespace
// (lib/soundscape-player.ts) into a vanilla JS class.
(() => {
  "use strict";

  const TRACKS = {
    low: [
      {
        title: "Calm Sketch for Piano",
        artist: "Kevin MacLeod",
        subtitle: "Quiet · 原聲鋼琴",
        src: "assets/audio/calm-sketch-for-piano.mp3",
      },
      {
        title: "Chill Air",
        artist: "Frank Nora",
        subtitle: "Quiet · Ambient chill",
        src: "assets/audio/chill-air.mp3",
      },
    ],
    medium: [
      {
        title: "Chill Beat",
        artist: "Frank Nora",
        subtitle: "Social · Chill beat",
        src: "assets/audio/chill-beat.mp3",
      },
      {
        title: "Meditating Beat",
        artist: "Kevin MacLeod",
        subtitle: "Social · Relaxed groove",
        src: "assets/audio/meditating-beat.mp3",
      },
    ],
    high: [
      {
        title: "Backbeat",
        artist: "Kevin MacLeod",
        subtitle: "Busy · Electronic groove",
        src: "assets/audio/backbeat.mp3",
      },
      {
        title: "Beat One",
        artist: "Kevin MacLeod",
        subtitle: "Busy · Driving beat",
        src: "assets/audio/beat-one.mp3",
      },
    ],
  };

  const DEMO_GAIN_OFFSET_DB = 10;
  const dbToGain = (db) => 10 ** (db / 20);

  function getSoundscapeMeta(energy, trackIndex = 0) {
    const tracks = TRACKS[energy];
    return tracks[((trackIndex % tracks.length) + tracks.length) % tracks.length];
  }

  function getSoundscapeTrackCount(energy) {
    return TRACKS[energy].length;
  }

  class SoundscapePlayer {
    constructor() {
      this.context = null;
      this.master = null;
      this.compressor = null;
      this.active = null;
      this.activeEnergy = null;
      this.activeTrackIndex = 0;
      this.destroyed = false;
    }

    ensureContext() {
      if (this.context && this.master) return;
      this.context = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.context.createGain();
      this.compressor = this.context.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 10;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.012;
      this.compressor.release.value = 0.3;
      this.master.connect(this.compressor).connect(this.context.destination);
    }

    async play(energy, gainDb, trackIndex = 0) {
      this.destroyed = false;
      this.ensureContext();
      if (!this.context || !this.master) return;
      this.master.gain.setValueAtTime(this.toDemoGain(gainDb), this.context.currentTime);
      void this.context.resume().catch(() => undefined);
      if (!this.active) {
        this.active = this.createScene(energy, trackIndex, 1);
        this.activeEnergy = energy;
        this.activeTrackIndex = trackIndex;
      }
      await this.active.audio.play();
    }

    async pause() {
      this.active?.audio.pause();
    }

    setTargetGainDb(gainDb, rampSeconds = 1.8) {
      if (!this.context || !this.master) return;
      const now = this.context.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(Math.max(0.0001, this.master.gain.value), now);
      this.master.gain.exponentialRampToValueAtTime(this.toDemoGain(gainDb), now + rampSeconds);
    }

    setTrack(energy, trackIndex = 0, crossfadeSeconds = 3.4) {
      if (!this.context || !this.master || !this.active) return;
      if (this.activeEnergy === energy && this.activeTrackIndex === trackIndex) return;

      const previous = this.active;
      const previousEnergy = this.activeEnergy;
      const previousTrackIndex = this.activeTrackIndex;
      const next = this.createScene(energy, trackIndex, 0);
      this.activeEnergy = energy;
      this.activeTrackIndex = trackIndex;

      void next.audio.play().then(() => {
        if (!this.context || this.destroyed) {
          this.stopScene(next);
          return;
        }
        const now = this.context.currentTime;
        const steps = 64;
        const fadeOut = new Float32Array(steps);
        const fadeIn = new Float32Array(steps);
        for (let index = 0; index < steps; index += 1) {
          const progress = index / (steps - 1);
          fadeOut[index] = Math.sqrt(1 - progress);
          fadeIn[index] = Math.sqrt(progress);
        }

        previous.gain.gain.cancelScheduledValues(now);
        next.gain.gain.cancelScheduledValues(now);
        previous.gain.gain.setValueCurveAtTime(fadeOut, now, crossfadeSeconds);
        next.gain.gain.setValueCurveAtTime(fadeIn, now, crossfadeSeconds);
        previous.stopTimer = window.setTimeout(() => this.stopScene(previous), (crossfadeSeconds + 0.2) * 1000);
        this.active = next;
      }).catch(() => {
        this.stopScene(next);
        this.activeEnergy = previousEnergy;
        this.activeTrackIndex = previousTrackIndex;
      });
    }

    async destroy() {
      this.destroyed = true;
      if (this.active) this.stopScene(this.active);
      this.active = null;
      this.activeEnergy = null;
      this.activeTrackIndex = 0;
      if (this.context && this.context.state !== "closed") await this.context.close();
      this.context = null;
      this.master = null;
      this.compressor = null;
    }

    createScene(energy, trackIndex, initialGain) {
      if (!this.context || !this.master) throw new Error("Audio context is not ready");
      const meta = getSoundscapeMeta(energy, trackIndex);
      const audio = new Audio(meta.src);
      audio.loop = true;
      audio.preload = "auto";
      const source = this.context.createMediaElementSource(audio);
      const gain = this.context.createGain();
      gain.gain.value = initialGain;
      source.connect(gain).connect(this.master);
      return { audio, source, gain };
    }

    stopScene(scene) {
      if (scene.stopTimer) window.clearTimeout(scene.stopTimer);
      scene.audio.pause();
      scene.source.disconnect();
      scene.gain.disconnect();
    }

    toDemoGain(gainDb) {
      return Math.min(0.72, Math.max(0.035, dbToGain(gainDb + DEMO_GAIN_OFFSET_DB)));
    }
  }

  window.VibeSpaceSoundscape = { SoundscapePlayer, getSoundscapeMeta, getSoundscapeTrackCount };
})();
