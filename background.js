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

function injectContentScript(tabId, callback) {
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

function sendMessageToActiveTab(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) return;
        const tabId = tabs[0].id;

        injectContentScript(tabId, () => {
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "closeTaskWindow" && taskWindowId) {
        chrome.windows.remove(taskWindowId);
        taskWindowId = null;
    } else if (message.action === "modifyPage") {
        sendMessageToActiveTab({ action: "modifyPage", task: message.task });
    }
});

// processing text with flask
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "processElements") {

        fetch("http://127.0.0.1:5000/process_elements", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                task: message.task,
                elementsMap: message.data
            })
        })
        .then(response => response.json())
        .then(data => {
            console.log("Text scores from flask in background.js:", data);
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs.length > 0) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: "updatePage",
                        elementsWithScores: data.elementsMap  
                    });
                }
            });

            sendResponse({ status: "Sent to content.js" })
        })
        .catch(error => {
            console.error("Error forwarding data:", error);
            sendResponse({ error: "Failed to send data" });
        });

        return true; 
    }
});

// processing visuals with flask
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "processMedia") {
        // console.log("Forwarding media to Flask:", message.images, message.iframes);

        fetch("http://127.0.0.1:5001/process_visuals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                task: message.task,
                images: message.images,
                iframes: message.iframes,
                svg: message.svg
            })
        })
        .then(response => response.json())
        .then(data => {
            console.log("Visual scores from flask:", data);
            sendResponse(data);
        })
        .catch(error => {
            console.error("Error forwarding data:", error);
            sendResponse({ error: "Failed to send data to Flask" });
        });

        return true; 
    }
});



