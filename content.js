chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.message === 'processTask') {
    console.log('Updated task in bg: ', request.data);
    processPage(request.data)
    sendResponse({ reply: 'Received task in bg!' });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.message === 'inject') {
      sendResponse({ reply: 'Already injected' });
    }
  });

function processPage(task) {
    console.log("Task has been updated in processPage:", task);

    let elementsTree = [];
    let imageData = [];
    let svgData = [];
    let iframeData = [];
    let idCounter = 0;
    let rootNode = null; 

    function getDirectText(element) {
        let text = "";
        for (let child of element.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                text += child.textContent.trim() + " ";
            }
        }
        return text.trim();
    }

    
    function traverseDOM(element, parentID = null) {
        if (!element || element.tagName === "SCRIPT" || element.tagName === "STYLE"  || element.tagName === "NOSCRIPT")  return null;

        let elementID = `elem-${idCounter++}`; 
        element.setAttribute("data-unique-id", elementID);
        
        let node = {
            id: elementID,
            tag: element.tagName,
            text: getDirectText(element),
            href: element.href || null,
            parentID: parentID,
            children: [],
            relevant: false
        };

        if (element.tagName === "IMG") {
            node.src = element.src || null;
            node.alt = element.alt || null;
            imageData.push({ id: elementID, src: node.src, alt: node.alt });
        }

        if (element.tagName === "SVG") {
            node.src = element.src || null;
            node.title = element.title || null;
            svgData.push({ id: elementID, src: node.src, alt: node.alt });
        }

        if (element.tagName === "IFRAME") {
            node.src = element.src || null;
            node.title = element.title || null;
            iframeData.push({ id: elementID, src: node.src, alt: node.alt });
        }

        elementsTree.push(node);

        for (let child of element.children) {
            let childNode = traverseDOM(child, elementID);
            if (childNode) node.children.push(childNode);
        }
        return node;
    }

    rootNode = traverseDOM(document.body);

    // console.log("Extracted DOM Tree:", elementsTree);
    
    function updateDOMVisibility(node) {
        let element = document.querySelector(`[data-unique-id='${node.id}']`);
        if (!element) return;
        if (node.relevant) {
            // element.style.removeProperty("display");
            score = Math.max(0, Math.min(node.score, 1));
            const colors = [
                "#ebfce8", // scores 0.0 - 0.1
                "#ebfce8", // 0.1 - 0.2
                "#ebfce8", // 0.2 - 0.3
                "#fff5b3", // 0.3 - 0.4
                "#e6f598", // 0.4 - 0.5
                "#fee08b", // 0.5 - 0.6
                "#fdae61", // 0.6 -0.7
                "#f46d43", // 0.7 - 0.8
                "#d53e4f", // 0.8 - 0.9
                "#9e0142"  // 0.9 - 1.0
            ];
        
            // mapping the score to a color from the palette
            const colorIndex = Math.floor(score * (colors.length - 1));
            const borderColor = colors[colorIndex];
            element.style.border = `2px solid ${borderColor}`;
            element.style.pointerEvents = "auto";
            element.setAttribute("aria-hidden", "false");
        } else {
            element.style.display = "none";
            element.style.pointerEvents = "none";
            element.setAttribute("aria-hidden", "true");
        }
    }

    
    chrome.runtime.sendMessage(
        {
            action: "processMedia",
            images: imageData,
            iframes: iframeData,
            svg: svgData,
            task: task
        },
        (response) => {
            if (chrome.runtime.lastError) {
                console.warn("Media message not delivered:", chrome.runtime.lastError);
            } else if (response && response.visual_scores) {
                let imageScoresMap = {};
                imageScores = response.visual_scores;
                imageScores.forEach((item) => {
                    imageScoresMap[item.id] = {
                        score: item.visual_score,
                    };
                });
            
                elementsTree.forEach((node) => {
                    if ((node.tag === "IMG") && imageScoresMap[node.id]) {
                        node.score = imageScoresMap[node.id].score;
                        node.relevant =  imageScoresMap[node.id].score >= 0;
                    }
                });
            }
             else {
                console.warn("Unexpected response:", response);
            }

            // processing text elements
            chrome.runtime.sendMessage(
                { action: "processElements", data: elementsTree, task: task },
                (textResponse) => {
                    if (chrome.runtime.lastError) {
                        console.warn("Text message not delivered:", chrome.runtime.lastError);
                    }
                    if (textResponse && textResponse.data) {
                        console.log("Text scores from flask:", textResponse.data);
                        
                        let textScoresMap = {};
                        
                        let textScores = textResponse.data.elementsMap;
                        textScores.forEach((item) => {
                            textScoresMap[item.id] = {
                                sbertScore: item.sbertScore,
                                bertScore:  item.bertScore,
                                gptScore: item.gptScore,
                                score: item.score
                            };
                        });

                        elementsTree.forEach((node) => {
                            const elementNode = textScoresMap[node.id];
                            if (elementNode) {
                            //   node.sbertScore = elementNode.sbertScore;
                            //   node.bertScore  = elementNode.bertScore;
                            //   node.gptScore   = elementNode.gptScore;
                              node.score      = elementNode.score;
                              node.relevant = node.score >= 0;
                            }
                          });

                          const parentMap = {};
                          elementsTree.forEach((el) => {
                            parentMap[el.id] = el;
                          });

                          function propagateRelevanceUpward(el) {
                            if (el.parentID && parentMap[el.parentID]) {
                              const parent = parentMap[el.parentID];
                              if (!parent.relevant) {
                                parent.relevant = true;
                                propagateRelevanceUpward(parent);
                              }
                            }
                          }
                    
                          // For every element that is relevant, mark the parents as relevant
                          elementsTree.forEach((el) => {
                            if (el.relevant) {
                              propagateRelevanceUpward(el);
                            }
                          });

                          elementsTree.forEach((el) => {
                            if (el.children && el.children.length > 0) {
                              el.children.forEach((child) => {
                                const childRef = parentMap[child.id];
                                if (childRef) {
                                  if ("sbertScore" in childRef) {
                                    child.sbertScore = childRef.sbertScore;
                                  }
                                  if ("bertScore" in childRef) {
                                    child.bertScore = childRef.bertScore;
                                  }
                                  if ("gptScore" in childRef) {
                                    child.gptScore = childRef.gptScore;
                                  }
                                  if ("score" in childRef) {
                                    child.score = childRef.score;
                                  }
                                  // If desired, you could also re-check child relevance here
                                  // child.relevant = (child.tag !== "IMG" && child.score >= 0)
                                }
                              });
                            }
                          });
                    
                          console.log("Updated DOM after setting relevance and propagating upward", elementsTree);
                        
                        elementsTree.forEach(node => {
                            updateDOMVisibility(node)
                        });

                        console.log("Page updated!");
                    }
                }
            );
        }
    );
}

// document.querySelectorAll("*").forEach((el) => {
//     if (!el.hasAttribute("data-unique-id")) {
//         el.setAttribute("data-unique-id", `elem-fallback`);
//     }
// });
// document.querySelectorAll("img").forEach((el, index) => {
//     el.setAttribute("data-unique-id", `img-${index}`);
// });
