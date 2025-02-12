document.getElementById("processTask").addEventListener("click", async () => {
    const task = document.getElementById("taskInput").value.trim();

    if (!task) {
        document.getElementById("status").innerText = "Please enter the task you'd like to do!";
        return;
    }

    chrome.storage.local.set({ activeTask: task }, () => {
        console.log("Task saved:", task);
    });

    document.getElementById("completeTask").style.display = "block";

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length === 0) return;

        chrome.tabs.sendMessage(tabs[0].id, { action: "modifyPage", task }, (response) => {
            document.getElementById("status").innerText = response?.message || "Processing...";
        });
    });
});

document.getElementById("completeTask").addEventListener("click", async () => {
    chrome.storage.local.remove("activeTask", () => {
        console.log("Task removed");
    });

    document.getElementById("status").innerText = "Task completed!";
    document.getElementById("completeTask").style.display = "none";

    chrome.runtime.sendMessage({ action: "closeTaskWindow" });
});




