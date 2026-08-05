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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OPEN_GITHUB") {
    chrome.tabs.create({ url: "https://github.com/Hemantkumar-Lakhane" });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "CALL_GEMINI") {
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${message.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: message.prompt }] }],
        generationConfig: { temperature: 0.1 }
      })
    })
    .then(r => {
      if (!r.ok) throw new Error("API Error " + r.status);
      return r.json();
    })
    .then(data => sendResponse({ data }))
    .catch(error => sendResponse({ error: error.message }));
    return true;
  }
});
