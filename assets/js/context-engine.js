// Room-state decision engine, ported from emma63194/vibespace (lib/context-engine.ts).
// Pure functions only — no DOM access — so it can be shared by main.js and future pages.
(() => {
  "use strict";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const round = (value, digits = 1) => {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  };

  // operationMode: "comfort" | "balanced" | "flow" | "manual"
  // calibration: { quietBaselineDbRel, normalBaselineDbRel, preferredGainDb, minimumGainDb, hardCeilingGainDb }
  function decideContext(input) {
    const {
      calibration,
      currentGainDb,
      currentState,
      operationMode,
      sustainedSeconds,
    } = input;

    const hold = (state, reasonCode, reason, confidence) => ({
      state,
      targetGainDb: round(
        clamp(currentGainDb, calibration.minimumGainDb, calibration.hardCeilingGainDb),
      ),
      energy: state === "quiet" ? "low" : state === "busy" ? "high" : "medium",
      tempoChange: "hold",
      confidence: round(clamp(confidence, 0, 1), 2),
      reasonCode,
      reason,
    });

    if (input.manualHold || operationMode === "manual") {
      return hold(currentState, "MANUAL_HOLD", "目前由店員手動控制，自動決策暫停。", 1);
    }

    if (input.dataQuality < 0.55) {
      return hold(
        "uncertain",
        "LOW_DATA_QUALITY",
        "感測品質不足，為避免誤判，系統維持目前設定。",
        input.dataQuality,
      );
    }

    const spikeDb = input.shortTermDbRel - input.longTermDbRel;
    if (input.transientScore >= 0.72 && spikeDb >= 5) {
      return hold(
        "transient",
        "TRANSIENT_IGNORED",
        `偵測到 ${round(spikeDb)} dB 的短暫尖峰，已忽略且不調整音樂。`,
        input.transientScore,
      );
    }

    const delta = input.longTermDbRel - calibration.normalBaselineDbRel;
    let candidate = "social";

    // 進入 busy 的門檻高於離開門檻，形成 hysteresis，避免反覆跳動。
    const busyThreshold = currentState === "busy" ? 2.5 : 4.5;
    const quietThreshold = currentState === "quiet" ? -2.5 : -4.5;
    if (delta >= busyThreshold) candidate = "busy";
    if (delta <= quietThreshold) candidate = "quiet";

    const confirmationSeconds = 10;
    const candidateSeconds = candidate === input.candidateState
      ? Math.max(0, input.candidateSeconds || 0)
      : 0;
    if (candidate !== currentState && candidateSeconds < confirmationSeconds) {
      return {
        ...hold(
        currentState,
        "STATE_CONFIRMING",
        `${candidate === "quiet" ? "空間轉靜" : "活動升高"}尚在確認中（${Math.round(candidateSeconds)} / ${confirmationSeconds} 秒）`,
        input.dataQuality * 0.72,
        ),
        candidateState: candidate,
        candidateSeconds,
        confirmationSeconds,
      };
    }

    let targetGainDb = calibration.preferredGainDb;
    let energy = "medium";
    let tempoChange = "hold";
    let reasonCode = "SOCIAL_STABLE";
    let reason = "現場處於穩定交談狀態，維持品牌設定的基準音量。";

    if (candidate === "quiet") {
      targetGainDb = calibration.preferredGainDb - 2;
      energy = "low";
      reasonCode = "QUIET_SUSTAINED";
      reason = "空間持續安靜，輕微降低存在感並維持柔和聲景。";
    }

    if (candidate === "busy") {
      if (operationMode === "comfort") {
        targetGainDb = calibration.preferredGainDb + 0.6;
        energy = "medium";
        reasonCode = "BUSY_COMFORT";
        reason = "活動持續升高；Comfort 模式只做極小補償，不追逐現場噪音。";
      } else if (operationMode === "flow") {
        targetGainDb = calibration.preferredGainDb + Math.min(4, Math.max(1.5, delta * 0.45));
        energy = "high";
        tempoChange = input.canChangeTrack ? "next-track" : "hold";
        reasonCode = "BUSY_FLOW";
        reason = input.canChangeTrack
          ? "忙碌狀態已持續成立；小幅提高音量，並在下一首提升音樂能量。"
          : "忙碌狀態已持續成立；小幅提高音量，曲目仍在冷卻期間。";
      } else {
        targetGainDb = calibration.preferredGainDb + Math.min(2.8, Math.max(0.8, delta * 0.32));
        energy = "high";
        tempoChange = input.canChangeTrack ? "next-track" : "hold";
        reasonCode = "BUSY_BALANCED";
        reason = input.canChangeTrack
          ? "相對一般基線持續升高；平順補償音量，並在下一首調整能量。"
          : "相對一般基線持續升高；只調整音量，暫不更換曲目。";
      }
    }

    return {
      state: candidate,
      targetGainDb: round(
        clamp(targetGainDb, calibration.minimumGainDb, calibration.hardCeilingGainDb),
      ),
      energy,
      tempoChange,
      confidence: round(clamp(input.dataQuality * (0.7 + Math.min(0.3, sustainedSeconds / 180)), 0, 1), 2),
      reasonCode,
      reason,
      candidateState: candidate,
      candidateSeconds,
      confirmationSeconds,
    };
  }

  const DEFAULT_CALIBRATION = {
    quietBaselineDbRel: -46,
    normalBaselineDbRel: -36,
    preferredGainDb: -22,
    minimumGainDb: -32,
    hardCeilingGainDb: -14,
  };

  window.VibeSpaceContextEngine = { decideContext, DEFAULT_CALIBRATION };
})();

