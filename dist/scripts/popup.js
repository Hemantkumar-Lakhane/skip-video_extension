const statusEl = document.getElementById("status");
const timeTextEl = document.getElementById("timeText");
const progressFillEl = document.getElementById("progressFill");

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToPage(message) {
  const tab = await activeTab();
  if (!tab?.id) return null;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    if (response?.found || message.type === "TOGGLE_FOCUS" || message.type === "GO_NEXT") return response;
  } catch {
    // Fall back to direct all-frame execution below.
  }

  return executeInFrames(tab.id, message);
}

async function executeInFrames(tabId, message) {
  if (!chrome.scripting?.executeScript) return null;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: runVideoCommandInFrame,
      args: [message]
    });

    const matches = results.map((item) => item.result).filter(Boolean);
    return matches.find((item) => item.found) || matches[0] || null;
  } catch {
    return null;
  }
}

function runVideoCommandInFrame(message) {
  function findVideoDeep(root) {
    const directVideo = root.querySelector?.("video");
    if (directVideo) return directVideo;

    const nodes = root.querySelectorAll?.("*") || [];
    for (const node of nodes) {
      if (node.shadowRoot) {
        const shadowVideo = findVideoDeep(node.shadowRoot);
        if (shadowVideo) return shadowVideo;
      }
    }

    return null;
  }

  function clampSpeed(speed) {
    return Math.max(0.25, Math.min(16, Number(speed) || 1));
  }

  function videoInfo(video) {
    if (!video) return { found: false };
    return {
      found: true,
      paused: video.paused,
      muted: video.muted,
      speed: video.playbackRate,
      currentTime: Math.round(video.currentTime || 0),
      duration: Math.round(video.duration || 0)
    };
  }

  const video = findVideoDeep(document);

  if (message.type === "SET_SPEED" && video) {
    video.playbackRate = clampSpeed(message.speed);
  }

  if (message.type === "JUMP" && video) {
    video.currentTime = Math.max(0, video.currentTime + Number(message.seconds || 0));
  }

  if (message.type === "TOGGLE_PLAY" && video) {
    if (video.paused) video.play();
    else video.pause();
  }

  if (message.type === "TOGGLE_MUTE" && video) {
    video.muted = !video.muted;
  }

  if (message.type === "SKIP_TO_END" && video && Number.isFinite(video.duration) && video.duration > 2) {
    video.currentTime = Math.max(0, video.duration - 2);
  }

  if (message.type === "GET_STATUS" || message.type === "SET_SPEED" || message.type === "JUMP" || message.type === "TOGGLE_PLAY" || message.type === "TOGGLE_MUTE" || message.type === "SKIP_TO_END") {
    return videoInfo(video);
  }

  return { found: false };
}

function updateStatus(info) {
  if (!info?.found) {
    statusEl.textContent = "No video found";
    timeTextEl.textContent = "--:-- / --:--";
    progressFillEl.style.width = "0%";
    return;
  }

  const state = info.paused ? "Paused" : "Playing";
  statusEl.textContent = `${state} at ${info.speed}x`;
  timeTextEl.textContent = `${formatTime(info.currentTime)} / ${formatTime(info.duration)}`;
  progressFillEl.style.width = `${progressPercent(info)}%`;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "00:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function progressPercent(info) {
  if (!info.duration) return 0;
  return Math.max(0, Math.min(100, Math.round((info.currentTime / info.duration) * 100)));
}

document.querySelectorAll(".speed-btn").forEach((button) => {
  button.addEventListener("click", async () => {
    const info = await sendToPage({ type: "SET_SPEED", speed: button.dataset.speed });
    updateStatus(info);
  });
});

document.querySelectorAll(".jump-btn").forEach((button) => {
  button.addEventListener("click", async () => {
    updateStatus(await sendToPage({ type: "JUMP", seconds: button.dataset.seconds }));
  });
});

document.getElementById("playBtn").addEventListener("click", async () => {
  updateStatus(await sendToPage({ type: "TOGGLE_PLAY" }));
});

document.getElementById("muteBtn").addEventListener("click", async () => {
  updateStatus(await sendToPage({ type: "TOGGLE_MUTE" }));
});

document.getElementById("focusBtn").addEventListener("click", async () => {
  await sendToPage({ type: "TOGGLE_FOCUS" });
});

document.getElementById("endBtn").addEventListener("click", async () => {
  updateStatus(await sendToPage({ type: "SKIP_TO_END" }));
});

document.getElementById("nextBtn").addEventListener("click", async () => {
  updateStatus(await sendToPage({ type: "GO_NEXT" }));
});

sendToPage({ type: "GET_STATUS" }).then(updateStatus);

// --- Settings Logic ---
const defaultSpeedEl = document.getElementById("defaultSpeed");
const autoMuteEl = document.getElementById("autoMute");
const focusDefaultEl = document.getElementById("focusDefault");
const autoNextEl = document.getElementById("autoNext");
const autoReadingEl = document.getElementById("autoReading");
const saveStatusEl = document.getElementById("saveStatus");

async function loadSettings() {
  const settings = await chrome.storage.sync.get({
    defaultSpeed: "1",
    autoMute: false,
    focusDefault: false,
    autoNext: false,
    autoReading: false
  });

  defaultSpeedEl.value = settings.defaultSpeed;
  autoMuteEl.checked = settings.autoMute;
  focusDefaultEl.checked = settings.focusDefault;
  autoNextEl.checked = settings.autoNext;
  autoReadingEl.checked = settings.autoReading;
}

async function saveSettings() {
  await chrome.storage.sync.set({
    defaultSpeed: defaultSpeedEl.value,
    autoMute: autoMuteEl.checked,
    focusDefault: focusDefaultEl.checked,
    autoNext: autoNextEl.checked,
    autoReading: autoReadingEl.checked
  });

  saveStatusEl.textContent = "Settings saved.";
  setTimeout(() => (saveStatusEl.textContent = ""), 3000);
}

document.getElementById("saveBtn").addEventListener("click", saveSettings);
loadSettings();
