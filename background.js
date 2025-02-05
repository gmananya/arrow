let taskWindowId = null;

chrome.action.onClicked.addListener(() => {
    if (taskWindowId) {
        chrome.windows.update(taskWindowId, { focused: true });
    } else {
        chrome.windows.create({
            url: "interface.html",
            type: "popup",
            width: 400,
            height: 500
        }, (window) => {
            taskWindowId = window.id;
        });
    }
});

// Function to inject content.js into the active tab before messaging
function ensureContentScript(tabId, callback) {
    chrome.scripting.executeScript(
        {
            target: { tabId: tabId },
            files: ["content.js"]
        },
        () => {
            if (chrome.runtime.lastError) {
                console.error("Error injecting content script:", chrome.runtime.lastError);
            } else {
                console.log("Content script injected successfully.");
                if (callback) callback();
            }
        }
    );
}

// Send a message to the active tab after ensuring content.js is active
function sendMessageToActiveTab(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) return;
        const tabId = tabs[0].id;

        ensureContentScript(tabId, () => {
            chrome.tabs.sendMessage(tabId, message, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn("Content script might not be ready:", chrome.runtime.lastError);
                } else {
                    console.log("Message sent successfully:", response);
                }
            });
        });
    });
}

// Handle messages from the popup interface
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "closeTaskWindow" && taskWindowId) {
        chrome.windows.remove(taskWindowId);
        taskWindowId = null;
    } else if (message.action === "modifyPage") {
        sendMessageToActiveTab({ action: "modifyPage", task: message.task });
    }
});
