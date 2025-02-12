import json
import requests
from flask_cors import CORS
from PIL import Image
from transformers import CLIPProcessor, CLIPModel
from flask import Flask, request, jsonify
import torch
from io import BytesIO

app = Flask(__name__)
CORS(app)  

DEVICE = "cpu"

model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to(DEVICE)
processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")

@app.route("/process_visuals", methods=["POST"])
def process_visuals():
    data = request.get_json()
    task = data.get("task", "")
    images = data.get("images", [])
    iframes = data.get("iframes", [])
    svg = data.get("svg", [])
    print("Received data:", task, len(images), len(iframes), len(svg))

    all_visuals = images + iframes + svg
    if not all_visuals:
        return jsonify({"error": "No images or iframes provided"}), 400

    # computing CLIP scores
    scores = get_clip_scores(task, all_visuals)
    return jsonify({"visual_scores": scores})

def get_clip_scores(task, image_urls):
    """ Compute CLIP similarity scores between task description and images """
    text_inputs = processor(text=[task], return_tensors="pt", padding=True, truncation=True).to(DEVICE)

    with torch.no_grad():
        text_features = model.get_text_features(**text_inputs)
        text_features /= text_features.norm(dim=-1, keepdim=True)

    scores = []
    for url in image_urls:
        try:
            response = requests.get(url, timeout=5)
            image = Image.open(BytesIO(response.content)).convert("RGB")
            image_inputs = processor(images=image, return_tensors="pt").to(DEVICE)

            with torch.no_grad():
                image_features = model.get_image_features(**image_inputs)
                image_features /= image_features.norm(dim=-1, keepdim=True)
                score = (image_features @ text_features.T).squeeze().item()

            scores.append({"url": url, "clip_score": score})
        except Exception as e:
            print(f"Error processing {url}: {e}")
            scores.append({"url": url, "clip_score": 0})

    return scores

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
