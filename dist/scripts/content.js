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
  const defaults = { defaultSpeed: "1", autoMute: false, focusDefault: false, autoNext: false, autoReading: false };
  return chrome.storage.sync.get(defaults);
}

let autoNextEnabled = false;
let autoReadingEnabled = false;

async function applyDefaultSettings() {
  const settings = await loadSettings();
  const video = getVideo();
  autoNextEnabled = settings.autoNext;
  autoReadingEnabled = settings.autoReading;
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

  if (message.type === "TOGGLE_AUTO_NEXT") {
    autoNextEnabled = message.enabled;
    sendResponse({ autoNext: autoNextEnabled });
    return true;
  }

  if (message.type === "START_QUIZ_SOLVER") {
    chrome.storage.sync.get({ geminiApiKey: "" }, (data) => {
      if (!data.geminiApiKey) {
        showToast("Error: Please set your Gemini API Key in the extension settings.");
      } else {
        chrome.storage.local.set({ isBulkCompletingQuizzes: true, geminiApiKey: data.geminiApiKey }, () => {
          showToast("Bulk Quiz Automation Started!");
          runBulkQuizAutomation();
        });
      }
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "START_BULK") {
    chrome.storage.local.set({ isBulkCompletingReadings: true }, () => {
      showToast("Bulk Automation Started!");
      runBulkAutomation();
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "STOP_BULK") {
    chrome.storage.local.set({ isBulkCompletingReadings: false, isBulkCompletingQuizzes: false }, () => {
      showToast("Bulk Automation Stopped");
    });
    if (bulkTimeoutId) clearTimeout(bulkTimeoutId);
    if (bulkQuizTimeoutId) clearTimeout(bulkQuizTimeoutId);
    sendResponse({ success: true });
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
    return text === "next" || text.startsWith("next ") || text.includes("go to next item");
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

function findCompleteButton() {
  return Array.from(document.querySelectorAll("button")).find((node) => {
    const text = (node.textContent || "").trim().toLowerCase();
    return text === "mark as completed" || text === "mark as complete";
  });
}

function showToast(message) {
  let toast = document.getElementById("lc-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "lc-toast";
    document.body.appendChild(toast);
  }
  
  toast.textContent = message;
  toast.classList.add("lc-toast-show");
  
  if (toast.hideTimeout) clearTimeout(toast.hideTimeout);
  
  toast.hideTimeout = setTimeout(() => {
    toast.classList.remove("lc-toast-show");
  }, 3000);
}

let bulkTimeoutId = null;

function runBulkAutomation() {
  try {
    if (!chrome.runtime?.id) return;
    chrome.storage.local.get("isBulkCompletingReadings", (data) => {
      if (!data.isBulkCompletingReadings) return;

      if (bulkTimeoutId) clearTimeout(bulkTimeoutId);

      bulkTimeoutId = setTimeout(() => {
        try {
          if (!chrome.runtime?.id) return;
          chrome.storage.local.get("isBulkCompletingReadings", (latestData) => {
            if (!latestData.isBulkCompletingReadings) return;

            window.scrollTo(0, document.body.scrollHeight);
            
            const completeBtn = findCompleteButton();
            if (completeBtn && !completeBtn.dataset.lcClicked) {
              showToast("Bulk Automation: Completing reading...");
              completeBtn.dataset.lcClicked = "true";
              completeBtn.click();
            }

            setTimeout(() => {
              const nextBtn = findNextControl();
              if (nextBtn) {
                showToast("Bulk Automation: Going to next item...");
                nextBtn.click();
                runBulkAutomation();
              } else {
                showToast("Bulk Automation: Finished or Locked item reached.");
                chrome.storage.local.set({ isBulkCompletingReadings: false });
                try {
                  chrome.runtime.sendMessage({ type: "OPEN_GITHUB" });
                } catch (e) {}
              }
            }, 100); 
          });
        } catch (e) {}
      }, 400);
    });
  } catch (e) {}
}

let bulkQuizTimeoutId = null;

function runBulkQuizAutomation() {
  try {
    if (!chrome.runtime?.id) return;
    chrome.storage.local.get(["isBulkCompletingQuizzes", "geminiApiKey"], (data) => {
      if (!data.isBulkCompletingQuizzes) return;

      if (bulkQuizTimeoutId) clearTimeout(bulkQuizTimeoutId);

      bulkQuizTimeoutId = setTimeout(() => {
        try {
          if (!chrome.runtime?.id) return;
          chrome.storage.local.get("isBulkCompletingQuizzes", (latestData) => {
            if (!latestData.isBulkCompletingQuizzes) return;

            const video = document.querySelector("video");
            const completeBtn = findCompleteButton();
            const inputs = document.querySelectorAll('input[type="radio"], input[type="checkbox"]');

            if (!video && !completeBtn && inputs.length > 0) {
              // It's a quiz!
              showToast("Bulk Quiz: Quiz detected! Solving...");
              solveQuiz(data.geminiApiKey);
            } else {
              // Check if we are on a quiz landing page
              const startQuizBtn = Array.from(document.querySelectorAll("button, a")).find(node => {
                const text = (node.textContent || "").trim().toLowerCase();
                return text === "start assignment" || text === "resume assignment" || text === "start quiz" || text === "resume quiz";
              });

              if (startQuizBtn) {
                showToast("Bulk Quiz: Entering assignment...");
                startQuizBtn.scrollIntoView({ behavior: "instant", block: "center" });
                startQuizBtn.click();
                bulkQuizTimeoutId = setTimeout(runBulkQuizAutomation, 1000); // Give it time to load the quiz
              } else {
                // Not a quiz. Skip it!
                showToast("Bulk Quiz: Skipping to next item...");
                const nextBtn = findNextControl();
                if (nextBtn) {
                  nextBtn.click();
                  runBulkQuizAutomation(); 
                } else {
                  showToast("Bulk Quiz: Finished or Locked item reached.");
                  chrome.storage.local.set({ isBulkCompletingQuizzes: false });
                  try {
                    chrome.runtime.sendMessage({ type: "OPEN_GITHUB" });
                  } catch (e) {}
                }
              }
            }
          });
        } catch (e) {}
      }, 400); 
    });
  } catch (e) {}
}

// Check if we should continue bulk automation on page load
let currentUrl = location.href;
const urlPollerId = setInterval(() => {
  try {
    if (!chrome.runtime?.id) {
      clearInterval(urlPollerId);
      return;
    }
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      chrome.storage.local.get(["isBulkCompletingReadings", "isBulkCompletingQuizzes"], (data) => {
        if (data.isBulkCompletingReadings) {
          runBulkAutomation();
        } else if (data.isBulkCompletingQuizzes) {
          runBulkQuizAutomation();
        }
      });
    }
  } catch (e) {
    clearInterval(urlPollerId);
  }
}, 1000);

runBulkAutomation();
runBulkQuizAutomation();

async function solveQuiz(apiKey) {
  showToast("AI Auto-Solver: Analyzing quiz...");

  const quizText = document.body.innerText.substring(0, 30000);
  const prompt = `You are an expert. I will provide the text of a multiple-choice quiz.
Read the questions and options carefully.
Identify the correct option(s) for each question.
Return ONLY a valid JSON array of strings, where each string is the EXACT, full text of a correct option.
If it is a true/false question, return the exact true or false text used in the option.
Do not include any other text, markdown formatting, or explanations.

Quiz Text:
${quizText}
`;

  try {
    showToast("AI Auto-Solver: Thinking...");
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ 
        type: "CALL_GEMINI", 
        apiKey: apiKey, 
        prompt: prompt 
      }, resolve);
    });

    if (!response || response.error) {
      throw new Error(response?.error || "Unknown API Error");
    }

    const data = response.data;
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    let answers = [];
    try {
      const jsonStr = resultText.replace(/```json/gi, "").replace(/```/g, "").trim();
      answers = JSON.parse(jsonStr);
    } catch (e) {
      console.error("Failed to parse Gemini response:", resultText);
      showToast("AI Auto-Solver: Failed to parse AI response.");
      return;
    }

    if (!Array.isArray(answers) || answers.length === 0) {
      showToast("AI Auto-Solver: No answers found.");
      return;
    }

    showToast("AI Auto-Solver: Applying answers...");
    
    // Select answers
    const inputs = Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]'));
    let selectedCount = 0;
    
    for (const answerText of answers) {
      const targetText = answerText.trim().toLowerCase();
      // Find the best matching input
      let bestMatch = null;
      for (const input of inputs) {
        const labelText = (input.closest('label') || input.parentElement || input).innerText.trim().toLowerCase();
        // Exact match or very close match
        if (labelText === targetText || labelText.includes(targetText) || targetText.includes(labelText)) {
          bestMatch = input;
          if (labelText === targetText) break; // Exact match, break early
        }
      }
      
      if (bestMatch && !bestMatch.checked) {
        bestMatch.scrollIntoView({ behavior: 'instant', block: 'center' });
        bestMatch.click();
        selectedCount++;
      }
    }

    // Check honor code
    for (const input of inputs) {
      if (input.type === 'checkbox') {
        const labelText = (input.closest('label') || input.parentElement || input).innerText.toLowerCase();
        if (labelText.includes("honor code") || labelText.includes("understand that submitting")) {
          if (!input.checked) {
            input.scrollIntoView({ behavior: 'instant', block: 'center' });
            input.click();
          }
        }
      }
    }

    showToast(`AI Auto-Solver: Applied ${selectedCount} answers! Please review before submitting.`);

  } catch (error) {
    console.error("AI Auto-Solver Error:", error);
    showToast("AI Auto-Solver: " + (error.message || "Error calling API"));
  }
}
