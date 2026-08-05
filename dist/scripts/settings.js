const defaultSpeedEl = document.getElementById("defaultSpeed");
const autoMuteEl = document.getElementById("autoMute");
const focusDefaultEl = document.getElementById("focusDefault");
const autoNextEl = document.getElementById("autoNext");
const statusEl = document.getElementById("status");

async function loadSettings() {
  const settings = await chrome.storage.sync.get({
    defaultSpeed: "1",
    autoMute: false,
    focusDefault: false,
    autoNext: false
  });

  defaultSpeedEl.value = settings.defaultSpeed;
  autoMuteEl.checked = settings.autoMute;
  focusDefaultEl.checked = settings.focusDefault;
  autoNextEl.checked = settings.autoNext;
}

async function saveSettings() {
  await chrome.storage.sync.set({
    defaultSpeed: defaultSpeedEl.value,
    autoMute: autoMuteEl.checked,
    focusDefault: focusDefaultEl.checked,
    autoNext: autoNextEl.checked
  });

  statusEl.textContent = "Settings saved.";
  setTimeout(() => {
    statusEl.textContent = "";
  }, 1800);
}

document.getElementById("saveBtn").addEventListener("click", saveSettings);
loadSettings();
