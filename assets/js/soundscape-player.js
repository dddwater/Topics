// Single-track soundscape player, ported from emma63194/vibespace
// (lib/soundscape-player.ts) into a vanilla JS class.
(() => {
  "use strict";

  const TRACKS = {
    low: [
      {
        title: "Chill Air",
        artist: "Frank Nora",
        subtitle: "Quiet · Ambient chill",
        src: "assets/audio/chill-air.mp3",
      },
      {
        title: "Meditating Beat",
        artist: "Kevin MacLeod",
        subtitle: "Quiet · Relaxed groove",
        src: "assets/audio/meditating-beat.mp3",
      },
      {
        title: "Chill Lofi Inspired",
        artist: "omfgdude",
        subtitle: "Quiet · Lofi piano",
        src: "assets/audio/chill-lofi-inspired.mp3",
      },
      {
        title: "Forget Me Not (Looped)",
        artist: "Kistol",
        subtitle: "Quiet · Gentle piano",
        src: "assets/audio/forget-me-not-looped.ogg",
      },
      {
        title: "Lofi Hip Hop Loop",
        artist: "omfgdude / OMF-Games",
        subtitle: "Quiet · Lofi hip-hop",
        src: "assets/audio/lofi-hip-hop-loop.ogg",
      },
    ],
    medium: [
      {
        title: "Hot Springs Town",
        artist: "Kistol",
        subtitle: "Social · Japanese cozy",
        src: "assets/audio/hot-springs-town.mp3",
      },
      {
        title: "Wednesday Night",
        artist: "Zane Little Music",
        subtitle: "Social · Chill funk fusion",
        src: "assets/audio/wednesday-night.mp3",
      },
      {
        title: "Lofi Hip Hop",
        artist: "omfgdude",
        subtitle: "Social · Relaxed beats",
        src: "assets/audio/lofi-hip-hop.ogg",
      },
      {
        title: "Cat Caffe",
        artist: "TAD",
        subtitle: "Social · Cozy lofi",
        src: "assets/audio/cat-caffe.mp3",
      },
      {
        title: "Calm Loop",
        artist: "wipics",
        subtitle: "Social · Ambient percussion",
        src: "assets/audio/calm-loop.mp3",
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
        title: "Funked Up",
        artist: "Joth",
        subtitle: "Busy · Funk groove",
        src: "assets/audio/funked-up.mp3",
      },
      {
        title: "Action Track",
        artist: "LushoGames",
        subtitle: "Busy · Funk rock",
        src: "assets/audio/action-track.mp3",
      },
      {
        title: "Funky Disco Beats",
        artist: "Fupi",
        subtitle: "Busy · Disco funk",
        src: "assets/audio/funky-disco.ogg",
      },
      {
        title: "Fusion Jazz",
        artist: "Spring Spring",
        subtitle: "Busy · Jazz fusion",
        src: "assets/audio/fusion-jazz.ogg",
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
    constructor(options = {}) {
      this.context = null;
      this.master = null;
      this.compressor = null;
      this.active = null;
      this.activeEnergy = null;
      this.activeTrackIndex = 0;
      this.destroyed = false;
      this.onTrackCycleComplete = options.onTrackCycleComplete || null;
      this.random = options.random || Math.random;
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

    setTrack(energy, trackIndex = 0) {
      if (!this.context || !this.master || !this.active) return;
      if (this.activeEnergy === energy && this.activeTrackIndex === trackIndex) return;

      const previous = this.active;
      const next = this.createScene(energy, trackIndex, 1);
      this.active = next;
      this.activeEnergy = energy;
      this.activeTrackIndex = trackIndex;
      this.stopScene(previous);

      void next.audio.play().catch(() => {
        if (this.active === next) {
          this.stopScene(next);
          this.active = null;
          this.activeEnergy = null;
          this.activeTrackIndex = 0;
        }
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
      audio.loop = false;
      audio.preload = "auto";
      const source = this.context.createMediaElementSource(audio);
      const gain = this.context.createGain();
      gain.gain.value = initialGain;
      source.connect(gain).connect(this.master);
      const scene = {
        audio,
        source,
        gain,
        energy,
        trackIndex,
        meta,
        loopsPlayed: 0,
        loopGoal: 2 + Math.floor(this.random() * 2),
      };
      scene.onEnded = () => {
        if (this.destroyed || this.active !== scene) return;
        scene.loopsPlayed += 1;
        if (scene.loopsPlayed < scene.loopGoal) {
          scene.audio.currentTime = 0;
          void scene.audio.play().catch(() => undefined);
          return;
        }
        this.onTrackCycleComplete?.({
          energy: scene.energy,
          trackIndex: scene.trackIndex,
          meta: scene.meta,
          loops: scene.loopGoal,
        });
      };
      audio.addEventListener("ended", scene.onEnded);
      return scene;
    }

    stopScene(scene) {
      scene.audio.removeEventListener("ended", scene.onEnded);
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

