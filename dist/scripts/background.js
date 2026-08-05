chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  if (command === "toggle_focus") {
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_FOCUS" });
  }

  if (command === "speed_up") {
    chrome.tabs.sendMessage(tab.id, { type: "SPEED_STEP", delta: 0.25 });
  }
});
