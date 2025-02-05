from flask import Flask, request, jsonify
import torch
from PIL import Image
import requests
from io import BytesIO
from transformers import CLIPProcessor, CLIPModel

app = Flask(__name__)

# Load CLIP model and processor
device = "cuda" if torch.cuda.is_available() else "cpu"
model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32").to(device)
processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")

def get_clip_score(image_url, text_query):
    try:
        # Download and preprocess the image
        response = requests.get(image_url)
        image = Image.open(BytesIO(response.content))

        # Tokenize text and process image
        inputs = processor(text=[text_query], images=image, return_tensors="pt", padding=True)
        inputs = {key: value.to(device) for key, value in inputs.items()}

        # Compute similarity score
        with torch.no_grad():
            outputs = model(**inputs)
            image_features = outputs.image_embeds
            text_features = outputs.text_embeds
            score = torch.cosine_similarity(image_features, text_features).item()

        return score
    except Exception as e:
        print("Error processing image:", e)
        return None

@app.route("/clip-score", methods=["POST"])
def clip_score():
    data = request.json
    task = data.get("task")
    image_urls = data.get("images", [])
    
    results = {}
    for img_url in image_urls:
        score = get_clip_score(img_url, task)
        if score is not None:
            results[img_url] = score

    return jsonify(results)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
