// Notify the background script that content.js is ready
chrome.runtime.sendMessage({ action: "contentScriptReady" });

// Check for an active task and process the page
chrome.storage.local.get("activeTask", (data) => {
    if (data.activeTask) {
        processPage(data.activeTask);
    }
});

// Listen for messages from the popup or background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "modifyPage") {
        processPage(message.task);
        sendResponse({ message: "Page updated!" });
    }
});

// Function to modify the page based on the task
function processPage(task) {
    let found = false;
    let imageData = [];
    let iframeData = [];

    document.querySelectorAll("h1, h2, h3, h4, h5, h6, p, a, li, i, ul, div, span").forEach(element => {
        if (!element.innerText.toLowerCase().includes(task.toLowerCase())) {
            // Visually dim the irrelevant content
            element.style.opacity = "0.2";
            element.style.filter = "blur(3px)";
            
            // Remove from screen reader access
            element.setAttribute("aria-hidden", "true");
            element.setAttribute("tabindex", "-1");
            
            // Disable user interaction
            element.style.pointerEvents = "none";
            element.style.visibility = "hidden"; // Hide while preserving layout
        } else {
            found = true;

            // Highlight relevant elements
            element.style.opacity = "1";
            element.style.filter = "none";

            // Ensure accessibility
            element.setAttribute("aria-hidden", "false");
            element.removeAttribute("tabindex");
            element.style.pointerEvents = "auto";
            element.style.visibility = "visible";
        }
    });

    // Process Images
    document.querySelectorAll("img").forEach(image => {
        if (image.src) {
            imageData.push(image.src);
        }
    });

    // Process Iframes
    document.querySelectorAll("iframe").forEach(iframe => {
        if (iframe.src) {
            iframeData.push(iframe.src);
        }
    });

    // Send Images & Iframes to Background for CLIP Score Processing
    if (imageData.length > 0 || iframeData.length > 0) {
        chrome.runtime.sendMessage({ 
            action: "processMedia",
            images: imageData,
            iframes: iframeData,
            task: task
        }, response => {
            if (chrome.runtime.lastError) {
                console.warn("Message not delivered:", chrome.runtime.lastError);
            } else {
                console.log("Media processing response:", response);
            }
        });
    }

    console.log(found ? "Page updated!" : "No relevant content found.");
}
