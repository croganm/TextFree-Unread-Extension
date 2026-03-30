chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "inject-main" || !sender.tab?.id) {
    return;
  }
  chrome.scripting
    .executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      files: ["inject-main.js"],
    })
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
  return true;
});
