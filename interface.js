document.getElementById("processTask").addEventListener("click", async () => {
    const task = document.getElementById("taskInput").value.trim();

    if (!task) {
        document.getElementById("status").innerText = "Please enter a task.";
        return;
    }

    // Save the task globally
    chrome.storage.local.set({ activeTask: task }, () => {
        console.log("Task saved:", task);
    });

    // Show "Task Completed!" button
    document.getElementById("completeTask").style.display = "block";

    // Send message to process the current page
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) return;

        chrome.tabs.sendMessage(tabs[0].id, { action: "modifyPage", task }, (response) => {
            document.getElementById("status").innerText = response?.message || "Processing...";
        });
    });
});

// Handle "Task Completed!" button click
document.getElementById("completeTask").addEventListener("click", async () => {
    chrome.storage.local.remove("activeTask", () => {
        console.log("Task removed");
    });

    document.getElementById("status").innerText = "Task completed!";
    document.getElementById("completeTask").style.display = "none";

    // Send message to close the task window
    chrome.runtime.sendMessage({ action: "closeTaskWindow" });
});


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "processMedia") {
        console.log("Processing images & iframes for task:", message.task);
        console.log('Images:', message.images);
        console.log('Iframes:', message.iframes);
        
        fetch("http://localhost:5000/clip-score", { // Correct API endpoint
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                task: message.task,
                images: message.images,
                iframes: message.iframes
            })
        })
        .then(response => response.json())
        .then(data => {
            console.log("CLIP Score Response:", data);
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs.length > 0) {
                    chrome.tabs.sendMessage(tabs[0].id, { action: "updateMedia", clipResults: data });
                }
            });
        })
        .catch(error => console.error("Error in CLIP Score API:", error));
    }
});

