const state = {
  focusMode: false
};

const focusSelectors = [
  "aside",
  "[data-testid*='sidebar']",
  "[class*='sidebar']",
  "[class*='Drawer']",
  "[class*='sticky']"
];

function getVideo() {
  return findVideoDeep(document);
}

function findVideoDeep(root) {
  const directVideo = root.querySelector?.("video");
  if (directVideo) return directVideo;

  const nodes = root.querySelectorAll?.("*") || [];
  for (const node of nodes) {
    if (node.shadowRoot) {
      const shadowVideo = findVideoDeep(node.shadowRoot);
      if (shadowVideo) return shadowVideo;
    }

    if (node.tagName === "IFRAME") {
      try {
        const frameVideo = node.contentDocument ? findVideoDeep(node.contentDocument) : null;
        if (frameVideo) return frameVideo;
      } catch {
        // Cross-origin frames are handled by the popup all-frame fallback.
      }
    }
  }

  return null;
}

function clampSpeed(speed) {
  return Math.max(0.25, Math.min(16, Number(speed) || 1));
}

function applySettingsToVideo(video, speed, shouldMute) {
  if (!video) return false;
  video.playbackRate = clampSpeed(speed);
  if (shouldMute) video.muted = true;
  return true;
}

async function loadSettings() {
  const defaults = { defaultSpeed: "1", autoMute: false, focusDefault: false, autoNext: false };
  return chrome.storage.sync.get(defaults);
}

let autoNextEnabled = false;

async function applyDefaultSettings() {
  const settings = await loadSettings();
  const video = getVideo();
  autoNextEnabled = settings.autoNext;
  applySettingsToVideo(video, settings.defaultSpeed, settings.autoMute);
  if (settings.focusDefault) setFocusMode(true);
}

function setFocusMode(enabled) {
  state.focusMode = enabled;
  document.documentElement.classList.toggle("lc-focus-mode", enabled);

  focusSelectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => {
      if (!node.closest(".rc-VideoMiniPlayer")) {
        node.classList.toggle("lc-hidden", enabled);
      }
    });
  });
}

function videoInfo() {
  const video = getVideo();
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const video = getVideo();

  if (message.type === "GET_STATUS") {
    sendResponse(videoInfo());
    return true;
  }

  if (message.type === "SET_SPEED") {
    if (video) video.playbackRate = clampSpeed(message.speed);
    sendResponse(videoInfo());
    return true;
  }

  if (message.type === "SPEED_STEP") {
    if (video) {
      const nextSpeed = clampSpeed(video.playbackRate + Number(message.delta || 0));
      video.playbackRate = nextSpeed;
    }
    sendResponse(videoInfo());
    return true;
  }

  if (message.type === "TOGGLE_PLAY") {
    if (video) {
      if (video.paused) video.play();
      else video.pause();
    }
    sendResponse(videoInfo());
    return true;
  }

  if (message.type === "JUMP") {
    if (video) video.currentTime = Math.max(0, video.currentTime + Number(message.seconds || 0));
    sendResponse(videoInfo());
    return true;
  }

  if (message.type === "SKIP_TO_END") {
    if (video && Number.isFinite(video.duration) && video.duration > 2) {
      video.currentTime = Math.max(0, video.duration - 2);
    }
    sendResponse(videoInfo());
    return true;
  }

  if (message.type === "GO_NEXT") {
    const nextButton = findNextControl();
    if (nextButton) nextButton.click();
    sendResponse(videoInfo());
    return true;
  }

  if (message.type === "TOGGLE_MUTE") {
    if (video) video.muted = !video.muted;
    sendResponse(videoInfo());
    return true;
  }

  if (message.type === "TOGGLE_FOCUS") {
    setFocusMode(!state.focusMode);
    sendResponse({ focusMode: state.focusMode });
    return true;
  }

  return false;
});

applyDefaultSettings();

const observer = new MutationObserver(() => {
  if (state.focusMode) setFocusMode(true);
  checkAndAttachEndedListener();
});

observer.observe(document.documentElement, { childList: true, subtree: true });

function findNextControl() {
  const candidates = [
    "a[aria-label*='Next' i]",
    "button[aria-label*='Next' i]",
    ".ytp-next-button",
    "a.ytp-next-button",
    "button.ytp-next-button",
    "a[data-track-component*='next' i]",
    "button[data-track-component*='next' i]"
  ];

  for (const selector of candidates) {
    const node = document.querySelector(selector);
    if (node) return node;
  }

  return Array.from(document.querySelectorAll("a, button")).find((node) => {
    const text = (node.textContent || "").trim().toLowerCase();
    return text === "next" || text.startsWith("next ");
  });
}

let attachedVideo = null;

function handleVideoEnded() {
  if (autoNextEnabled) {
    const nextButton = findNextControl();
    if (nextButton) nextButton.click();
  }
}

function checkAndAttachEndedListener() {
  const video = getVideo();
  if (video && video !== attachedVideo) {
    if (attachedVideo) attachedVideo.removeEventListener("ended", handleVideoEnded);
    video.addEventListener("ended", handleVideoEnded);
    attachedVideo = video;
  }
}
