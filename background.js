chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'forward-to-tab') return false;
  const { tabId, payload } = message;
  if (!tabId || !payload) return false;
  chrome.tabs.sendMessage(tabId, payload, (response) => {
    sendResponse(response);
  });
  return true;
});
