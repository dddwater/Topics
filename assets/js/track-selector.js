(() => {
  "use strict";

  class NonRepeatingTrackSelector {
    constructor(getTrackCount, options = {}) {
      this.getTrackCount = getTrackCount;
      this.random = options.random || Math.random;
      this.historySize = options.historySize ?? 2;
      this.history = { low: [], medium: [], high: [] };
    }

    reset() {
      this.history = { low: [], medium: [], high: [] };
    }

    next(energy, currentIndex = null) {
      const count = this.getTrackCount(energy);
      if (count <= 1) return 0;

      const recent = this.history[energy] || [];
      let choices = Array.from({ length: count }, (_, index) => index)
        .filter((index) => index !== currentIndex && !recent.includes(index));
      if (!choices.length) {
        choices = Array.from({ length: count }, (_, index) => index)
          .filter((index) => index !== currentIndex);
      }

      const selected = choices[Math.floor(this.random() * choices.length)];
      const maxHistory = Math.min(this.historySize, count - 1);
      this.history[energy] = [...recent, selected].slice(-maxHistory);
      return selected;
    }
  }

  window.VibeSpaceTrackSelection = { NonRepeatingTrackSelector };
})();
