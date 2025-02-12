chrome.runtime.sendMessage({ action: "contentScriptReady" });

chrome.storage.local.get("activeTask", (data) => {
    if (data.activeTask) {
        processPage(data.activeTask);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "modifyPage") {
        processPage(message.task);
        sendResponse({ message: "Page updated!" });
    }
});

function processPage(task) {
    let imageData = [];
    let iframeData = [];
    let svgData = [];
    elementsMap = []; 

    document.querySelectorAll("h1, h2, h3, h4, h5, h6, p, a, li, span, div, input").forEach(element => {
        if (element.innerText.trim().length > 0) {
            elementsMap.push({
                tag: element.tagName,        
                text: element.innerText,     
                href: element.href || null,
                classList: [...element.classList]
            });
        }
    });
    
    // console.log("elementsMap:", elementsMap);
    chrome.runtime.sendMessage({ action: "processElements", data: elementsMap, task: task });

    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === "updatePage" && message.elementsWithScores) {
            // console.log("Filtered text: ", message.elementsWithScores);
    
            message.elementsWithScores.forEach((item) => {
                // locatng the actual DOM element using its text and tag
                let matchingElements = Array.from(document.querySelectorAll(item.tag)).filter(el => el.innerText.trim() === item.text);
    
                matchingElements.forEach((element) => {
                    let score = item.score;    
                    if (score < 0.3) { 
                        console.log(`Hiding: "${element.innerText}" (Score: ${score})`);
                        element.style.display = "none";
                    } else {
                        // console.log(` Keeping: "${element.innerText}" (Score: ${score})`);
                        element.style.display = "block";
                    }
                });
            });
    
            console.log(" Page updated with filtered elements!");
        }
    });
    
     // processing images
     document.querySelectorAll("img").forEach(image => {
        if (image.src) {
            imageData.push(image.src);
        }
    });

    // processing iframes
    document.querySelectorAll("iframe").forEach(iframe => {
        if (iframe.src) {
            iframeData.push(iframe.src);
        }
    });

    document.querySelectorAll("svg").forEach(svg => {
        if (svg.src) {
            svgData.push(svg.src);
        }
    });


    // sending images & iframes to CLIP score processing
    if (imageData.length > 0 || iframeData.length > 0) {
        chrome.runtime.sendMessage(
            {
                action: "processMedia",
                images: imageData,
                iframes: iframeData,
                svg: svgData,
                task: task
            },
            response => {
                if (chrome.runtime.lastError) {
                    console.warn("Message not delivered:", chrome.runtime.lastError);
                } else if (response && response.visual_scores) {
                    // console.log("Processed visuals:", response.visual_scores);
    
                    response.visual_scores.forEach((item) => {
                        let matchingElements = Array.from(document.querySelectorAll(`img[src="${item.url}"], iframe[src="${item.url}"], svg[src="${item.url}"]`));
    
                        matchingElements.forEach((element) => {
                            let score = item.clip_score;    
                            if (score < 0.15) {
                                console.log(`Hiding: ${element.tagName} (Score: ${score})`);
                                element.style.display = "none";
                            } else {
                                // console.log(`Keeping: ${element.tagName} (Score: ${score})`);
                                element.style.display = "block";
                            }
                        });
                    });
                } else {
                    console.warn("Unexpected response:", response);
                }
            }
        );
    }
    
}


