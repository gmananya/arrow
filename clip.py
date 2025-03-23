import json
import requests
from flask_cors import CORS
from PIL import Image
from transformers import CLIPProcessor, CLIPModel
from sentence_transformers import SentenceTransformer, util
from flask import Flask, request, jsonify
import torch
from io import BytesIO

app = Flask(__name__)
CORS(app)

DEVICE = "cpu"

sbert_model = SentenceTransformer('all-MiniLM-L6-v2')

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

    scores = []

    # processing images
    for visual in images:
        visual = get_clip_scores(task, visual)
        visual = get_sbert_scores(task, visual)
        visual = get_visual_scores(visual)
        scores.append(visual)

    # processing iframes
    for visual in iframes:
        visual = get_clip_scores(task, visual)
        visual = get_sbert_scores(task, visual)
        visual = get_visual_scores(visual)
        scores.append(visual)

    # processning svg
    for visual in svg:
        visual = get_clip_scores(task, visual)
        visual = get_sbert_scores(task, visual)
        visual = get_visual_scores(visual)
        scores.append(visual)

    for visual in scores:
        if "visual_score" not in visual:
            visual["visual_score"] = 0 

    scores = [v for v in scores if "visual_score" in v]

    scores = sorted(scores, key=lambda x: x["visual_score"], reverse=True)

    print("Processed, sorted visuals with scores:", scores[:2])
    return jsonify({"visual_scores": scores})


def get_clip_scores(task, visual):
    visual_url = visual.get("src", "")

    try:
        text_inputs = processor(text=[task], return_tensors="pt", padding=True, truncation=True).to(DEVICE)

        with torch.no_grad():
            text_features = model.get_text_features(**text_inputs)
            text_features /= text_features.norm(dim=-1, keepdim=True)

        response = requests.get(visual_url, timeout=5)
        response.raise_for_status()  

        image = Image.open(BytesIO(response.content)).convert("RGB")
        image_inputs = processor(images=image, return_tensors="pt").to(DEVICE)

        with torch.no_grad():
            image_features = model.get_image_features(**image_inputs)
            image_features /= image_features.norm(dim=-1, keepdim=True)

        score = (image_features @ text_features.T).squeeze().item()

        visual["clip_score"] = score
        visual["url"] = visual_url

    except Exception as e:
        print(f"Error processing {visual_url}: {e}")
        visual["clip_score"] = 0  

    return visual


def get_sbert_scores(task, visual):
    alt_text = visual.get("alt", "") or visual.get("title", "") or "No description available"

    try:
        task_embedding = sbert_model.encode(task, convert_to_tensor=True)
        text_embedding = sbert_model.encode(alt_text, convert_to_tensor=True)
        sbert_score = util.pytorch_cos_sim(task_embedding, text_embedding).squeeze().tolist()

    except Exception as e:
        print(f"Error processing SBERT for {alt_text}: {e}")
        sbert_score = 0  

    visual["alt_title"] = alt_text
    visual["sbert_score"] = sbert_score
    return visual


def get_visual_scores(visual):
    """Ensure both clip_score and sbert_score exist before computing visual_score"""
    visual["clip_score"] = visual.get("clip_score", 0)
    visual["sbert_score"] = visual.get("sbert_score", 0)
    visual["visual_score"] = visual["clip_score"] * 0.4 + visual["sbert_score"] * 0.6
    return visual

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)



