(function () {
  let audioContext;
  let oscillator;
  let gainNode;
  let analyser;
  let microphoneSource;
  let microphoneStream;
  let animationFrameId;
  let smoothedDominantFrequency = 0;
  let lastOscillatorUpdate = 0;
  let oscillatorUpdateInterval = 400;
  let isPlaying = false;

  const playButton = document.getElementById("playBtn");
  const micButton = document.getElementById("micBtn");
  const volumeControl = document.getElementById("volume");
  const intervalControl = document.getElementById("interval");
  const intervalLabel = document.getElementById("intervalLabel");
  const rmsMeter = document.getElementById("meter");
  const dominantFrequencyOutput = document.getElementById("domFreq");
  const quantizedFrequencyOutput = document.getElementById("quantFreq");
  const chartCanvas = document.getElementById("freqChart");
  const chartContext = chartCanvas.getContext("2d");
  const frequencyHistory = [];
  const maxHistory = 80;

  function ensureAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      gainNode = audioContext.createGain();
      gainNode.gain.value = Number(volumeControl.value || 0.6);
      gainNode.connect(audioContext.destination);
    }

    return audioContext;
  }

  async function resumeAudioContext() {
    const context = ensureAudioContext();
    if (context.state === "suspended") {
      await context.resume();
    }
    return context;
  }

  function startOscillator() {
    const context = ensureAudioContext();
    oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = 220;
    oscillator.connect(gainNode);
    oscillator.start();
  }

  function stopOscillator() {
    if (!oscillator) return;
    oscillator.stop();
    oscillator.disconnect();
    oscillator = null;
  }

  function getDominantFrequency(currentAnalyser, sampleRate) {
    const frequencyData = new Uint8Array(currentAnalyser.frequencyBinCount);
    currentAnalyser.getByteFrequencyData(frequencyData);

    let maxMagnitude = -1;
    let maxIndex = -1;
    for (let index = 0; index < frequencyData.length; index += 1) {
      if (frequencyData[index] > maxMagnitude) {
        maxMagnitude = frequencyData[index];
        maxIndex = index;
      }
    }

    return maxIndex > 0 ? (maxIndex * sampleRate) / currentAnalyser.fftSize : 0;
  }

  function quantizeToPentatonicScale(frequency) {
    if (!frequency || frequency <= 0) return 0;

    const majorPentatonic = [0, 2, 4, 7, 9];
    const rootMidi = 57;
    const midi = 69 + 12 * Math.log2(frequency / 440);
    let bestMidi = rootMidi;
    let bestDiff = Infinity;

    for (let octave = -4; octave <= 4; octave += 1) {
      majorPentatonic.forEach((semitone) => {
        const candidate = rootMidi + octave * 12 + semitone;
        const diff = Math.abs(candidate - midi);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestMidi = candidate;
        }
      });
    }

    return 440 * 2 ** ((bestMidi - 69) / 12);
  }

  function drawFrequencyChart() {
    const width = chartCanvas.width;
    const height = chartCanvas.height;
    chartContext.clearRect(0, 0, width, height);
    chartContext.fillStyle = "#10131a";
    chartContext.fillRect(0, 0, width, height);

    if (frequencyHistory.length === 0) return;

    const minFrequency = Math.min(...frequencyHistory, 40);
    const maxFrequency = Math.max(...frequencyHistory, 500);
    const range = Math.max(maxFrequency - minFrequency, 1);

    chartContext.strokeStyle = "#65d6bd";
    chartContext.lineWidth = 3;
    chartContext.beginPath();

    frequencyHistory.forEach((frequency, index) => {
      const x = 16 + (index / (maxHistory - 1)) * (width - 32);
      const y = height - 18 - ((frequency - minFrequency) / range) * (height - 36);
      if (index === 0) chartContext.moveTo(x, y);
      else chartContext.lineTo(x, y);
    });

    chartContext.stroke();
    chartContext.fillStyle = "#f7f3ea";
    chartContext.font = "13px Inter, Segoe UI, sans-serif";
    chartContext.fillText(`min ${minFrequency.toFixed(0)} Hz`, 16, height - 8);
    chartContext.fillText(`max ${maxFrequency.toFixed(0)} Hz`, 16, 18);
  }

  function readMicrophone() {
    if (!analyser || !audioContext) return;

    const timeData = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(timeData);

    let sum = 0;
    timeData.forEach((sample) => {
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    });

    const rms = Math.sqrt(sum / timeData.length);
    rmsMeter.textContent = `RMS: ${rms.toFixed(3)}`;

    const dominantFrequency = getDominantFrequency(analyser, audioContext.sampleRate);
    dominantFrequencyOutput.textContent = dominantFrequency > 0
      ? `Dominant: ${dominantFrequency.toFixed(1)} Hz`
      : "Dominant: -- Hz";

    if (dominantFrequency > 0) {
      smoothedDominantFrequency += (dominantFrequency - smoothedDominantFrequency) * 0.12;
    }

    if (oscillator && smoothedDominantFrequency > 0) {
      const now = Date.now();
      if (now - lastOscillatorUpdate >= oscillatorUpdateInterval) {
        const quantizedFrequency = Math.min(
          Math.max(quantizeToPentatonicScale(smoothedDominantFrequency), 40),
          5000
        );

        oscillator.frequency.setValueAtTime(quantizedFrequency, audioContext.currentTime);
        quantizedFrequencyOutput.textContent = `Quantized: ${quantizedFrequency.toFixed(1)} Hz`;
        lastOscillatorUpdate = now;

        frequencyHistory.push(quantizedFrequency);
        if (frequencyHistory.length > maxHistory) frequencyHistory.shift();
        drawFrequencyChart();
      }
    }

    if (gainNode) {
      const targetGain = rms > 0.06 ? 0.18 : Number(volumeControl.value || 0.6);
      gainNode.gain.value += (targetGain - gainNode.gain.value) * 0.1;
    }

    animationFrameId = requestAnimationFrame(readMicrophone);
  }

  playButton.addEventListener("click", async () => {
    await resumeAudioContext();

    if (!isPlaying) {
      startOscillator();
      playButton.textContent = "Stop Tone";
      isPlaying = true;
    } else {
      stopOscillator();
      playButton.textContent = "Play Tone";
      isPlaying = false;
    }
  });

  volumeControl.addEventListener("input", () => {
    if (gainNode) gainNode.gain.value = Number(volumeControl.value);
  });

  intervalControl.addEventListener("input", () => {
    oscillatorUpdateInterval = Number(intervalControl.value);
    intervalLabel.textContent = `${oscillatorUpdateInterval} ms`;
  });

  micButton.addEventListener("click", async () => {
    if (microphoneStream) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      window.alert("This browser does not support microphone input.");
      return;
    }

    try {
      await resumeAudioContext();
      microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      microphoneSource = audioContext.createMediaStreamSource(microphoneStream);
      microphoneSource.connect(analyser);
      micButton.textContent = "Mic On";
      micButton.disabled = true;
      readMicrophone();
    } catch (error) {
      console.error(error);
      window.alert("Microphone permission was not granted.");
    }
  });

  window.addEventListener("pagehide", () => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    stopOscillator();
    if (microphoneSource) microphoneSource.disconnect();
    if (microphoneStream) {
      microphoneStream.getTracks().forEach((track) => track.stop());
    }
  });

  drawFrequencyChart();
})();
