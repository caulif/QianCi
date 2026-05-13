chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.get(['qianci.profile']);
});

export {};
