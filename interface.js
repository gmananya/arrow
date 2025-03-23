document.addEventListener("DOMContentLoaded", () => {
    const displayStyleSelect = document.getElementById('displayStyle');
    const relevanceSliderContainer = document.getElementById('relevanceSliderContainer');
    const relevanceThreshold = document.getElementById('relevanceThreshold');
    const relevanceValue = document.getElementById('relevanceValue');
    let startTaskButton = document.getElementById('startTask');

    displayStyleSelect.addEventListener('change', function() {
        if (this.value === 'task-specific') {
            relevanceSliderContainer.classList.remove('hidden');
        } else {
            relevanceSliderContainer.classList.add('hidden');
        }
    });
    
    relevanceThreshold.addEventListener('input', function() {
        relevanceValue.textContent = this.value;
    });

    startTaskButton.addEventListener('click', () => {
        let taskInput = document.getElementById("taskUpdate").value.trim();
        if (taskInput === "") return;
        
        displayTask(taskInput);
        
        chrome.runtime.sendMessage({ message: 'taskUpdate', data: taskInput }, (response) => {
            console.log('Popup received response:', response.reply);
        });

        startTaskButton.innerText = "Update task";
    });
       
    document.getElementById('completeTask').addEventListener('click', () => {
        completeTask();
    });

})

function displayTask(taskText) {
    let taskList = document.getElementById("taskList");

    let taskBox = document.createElement("div");
    taskBox.className = "task-box";
    taskBox.innerText = taskText;

    taskList.appendChild(taskBox);
    document.getElementById("taskUpdate").value = "";

    if (taskList.children.length === 1) {
        document.getElementById("userTaskLabel").classList.remove("hidden");
        document.getElementById("addTaskLabel").innerText = "Add task updates!";
    }

    document.getElementById("completeTask").classList.remove("hidden");
}

function completeTask() {
    document.getElementById("status").innerText = "Task completed!";
    
    setTimeout(() => {
        window.close();
    }, 500);
}
