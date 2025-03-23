from http import client
from flask import Flask, request, jsonify
from flask_cors import CORS
from sentence_transformers import SentenceTransformer, util
import warnings
import time
from bert_score import BERTScorer
import torch
import numpy as np
import json 
import os
import openai


warnings.filterwarnings("ignore", message="Some weights of RobertaModel were not initialized")
warnings.filterwarnings("ignore", category=UserWarning, message=".*resource_tracker.*")
os.environ["TOKENIZERS_PARALLELISM"] = "false"

app = Flask(__name__)
CORS(app)

sbert_model = SentenceTransformer('all-MiniLM-L6-v2')
bert_scorer = BERTScorer(model_type='roberta-large', lang='en')
api_key = ""

# computing normalized SBERT similarity scores
def compute_sbert_scores(task, texts, model):
    if not texts:
        return [0] * len(texts)

    task_embedding = model.encode(task, convert_to_tensor=True)

    def batch_encode(texts, batch_size=256):
        embeddings = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i+batch_size]
            batch_embeds = model.encode(batch, convert_to_tensor=True)
            embeddings.append(batch_embeds)
        return torch.cat(embeddings, dim=0)

    text_embeddings = batch_encode(texts)
    similarity_scores = util.pytorch_cos_sim(task_embedding, text_embeddings).squeeze().tolist()

    min_s, max_s = min(similarity_scores, default=0), max(similarity_scores, default=1)
    normalized = [(s - min_s) / (max_s - min_s + 1e-8) for s in similarity_scores]
    return normalized

# compute normalized BERTScore F1 similarity scores
def compute_bert_scores(task, texts, scorer):
    if not texts:
        return [0] * len(texts)

    _, _, F1 = scorer.score(texts, [task] * len(texts))
    scores = F1.cpu().tolist()

    min_b, max_b = min(scores, default=0), max(scores, default=1)
    normalized = [(b - min_b) / (max_b - min_b + 1e-8) for b in scores]
    return normalized

# compute normalized GPT scores using OpenAI API
def compute_openai_scores(api_key, task, text, batch_size=50):
    start_time = time.time()
    client = openai.OpenAI(api_key=api_key)
    all_scores = []

    def normalize(scores):
        return [round(min(max(score / 100.0, 0), 1), 3) for score in scores]

    for batch_start in range(0, len(text), batch_size):
        batch = text[batch_start:batch_start + batch_size]
        print(f"\nScoring batch {batch_start}–{batch_start + len(batch)}")

        numbered_elements = "\n".join([f"{i+1}. {t}" for i, t in enumerate(batch)])

        # Construct the prompt for OpenAI
        prompt = f"""
            Given the task: "{task}", evaluate each of the following text snippets and assign an importance between 0 to 100.
            100 = critical for the task, 0 = irrelevant.

            Return only an array with {len(batch)} scores. Do NOT include any explanation, notes, or additional text.

            Example output format: [12, 87, 34, 0, 75]

            Text snippets to score: {numbered_elements}
        """

        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are an expert task evaluator."},
                    {"role": "user", "content": prompt}
                ]
            )

            # Parse and clean the response
            completion_text = response.choices[0].message.content.strip()
            print("Raw GPT output:", completion_text)

            scores = json.loads(completion_text)

            if not isinstance(scores, list):
                raise ValueError("Expected a list of scores.")

            if len(scores) != len(batch):
                raise ValueError(f"Mismatch: got {len(scores)} scores for {len(batch)} elements.")

            normalized_scores = normalize(scores)

            for t, s in zip(batch, normalized_scores):
                print({"text": t, "score": s})

            all_scores.extend(normalized_scores)


        except json.JSONDecodeError as e:
            print("JSON decode error:", e)
            return {"error": f"Invalid JSON format: {e}"}

        except Exception as e:
            print("Scoring failed:", e)
            return {"error": f"Failed to score batch {batch_start}: {e}"}

    print(f"\nCompleted scoring {len(text)} elements.")
    end_time = time.time()  
    print(f"\nCompleted scoring {len(text)} elements in {round(end_time - start_time, 2)} seconds.")
    return all_scores

# weighted combination of SBERT and BERT scores
def compute_final_scores(sbert_scores, bert_scores, gpt_scores, alpha=0, beta=0, gamma=1):
    max_len = max(len(sbert_scores), len(bert_scores), len(gpt_scores))
    print("Length of all scores: ", len(sbert_scores), len(bert_scores), len(gpt_scores))
    sbert_scores = [float(sbert_scores[i]) if i < len(sbert_scores) else 0.0 for i in range(max_len)]
    bert_scores = [float(bert_scores[i]) if i < len(bert_scores) else 0.0 for i in range(max_len)]
    gpt_scores = [float(gpt_scores[i]) if i < len(gpt_scores) else 0.0 for i in range(max_len)]

    final = [
        round(alpha * s + beta * b + gamma * g, 3)
        for s, b, g in zip(sbert_scores, bert_scores, gpt_scores)
    ]
    return final

@app.route('/process_elements', methods=['POST'])
def process_elements():
    try:
        data = request.json
        user_task = data.get('task', "")
        elements_map = data.get('elementsMap', [])

        print("Received task:", user_task, "Elements count:", len(elements_map))

        if not user_task or not elements_map:
            return jsonify({"error": "Missing task or elementsMap"}), 400

        # Find elements with text
        text_elements = [item.get("text", "").strip() for item in elements_map if item.get("text", "").strip()]
        to_score_indices = [
            i for i, el in enumerate(elements_map)
            if isinstance(el.get("text", ""), str) and len(el["text"].strip()) > 2
        ]
        text_elements_to_score = [elements_map[i]["text"].strip() for i in to_score_indices]

        print("length of text elements:", len(text_elements))
        print("length of to_score_indices:", len(to_score_indices))
        print("length of text_elements_to_score:", len(text_elements_to_score))

        # Compute scores
        sbert_norm = compute_sbert_scores(user_task, text_elements_to_score, sbert_model)
        bert_norm = compute_bert_scores(user_task, text_elements_to_score, bert_scorer)
        gpt_norm = compute_openai_scores(api_key, user_task, text_elements_to_score)

        if isinstance(gpt_norm, dict) and "error" in gpt_norm:
            return jsonify({"error": f"GPT scoring failed: {gpt_norm['error']}"}), 500

        print("SBERT scores:", sbert_norm[:10])
        print("BERT scores:", bert_norm[:10])
        print("GPT scores:", gpt_norm)
        print("type of GPT scores:", type(gpt_norm))

        final_scores = compute_final_scores(sbert_norm, bert_norm, gpt_norm)

        for el in elements_map:
            if el.get("tag") != "IMG":
                el["sbertScore"] = 0.0
                el["bertScore"] = 0.0
                el["gptScore"] = 0.0
                el["score"] = 0.0
                el["relevant"] = False

        for idx, original_idx in enumerate(to_score_indices):
            elements_map[original_idx]["sbertScore"] = sbert_norm[idx]
            elements_map[original_idx]["bertScore"] = bert_norm[idx]
            elements_map[original_idx]["gptScore"] = gpt_norm[idx]
            elements_map[original_idx]["score"] = final_scores[idx]
            

        '''
        # Optional: propagate relevance to parents
        parent_map = {el["id"]: el for el in elements_map}
        
        def propagate_relevance_upward(el):
            if "parentID" in el and el["parentID"] in parent_map:
                parent = parent_map[el["parentID"]]
                if not parent.get("relevant"):
                    parent["relevant"] = True
                    propagate_relevance_upward(parent)

        for el in elements_map:
            if el.get("relevant"):
                propagate_relevance_upward(el)

        # update children scores
        for el in elements_map:
            if "children" in el:
                for child in el["children"]:
                    if child["id"] in parent_map:
                        child_ref = parent_map[child["id"]]
                        if "sbertScore" in child_ref:
                            child["sbertScore"] = child_ref["sbertScore"]
                        if "bertScore" in child_ref:
                            child["bertScore"]  = child_ref["bertScore"]
                        if "gptScore" in child_ref:
                            child["gptScore"]   = child_ref["gptScore"]
                        if "score" in child_ref:
                            child["score"]      = child_ref["score"]
        '''

        elements_map.sort(key=lambda x: x["score"], reverse=True)

        return jsonify({"elementsMap": elements_map})

    except Exception as e:
        return jsonify({"error": f"Processing failed: {str(e)}"}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)


'''
actionable_tags = {"button", "input", "select", "textarea", "form"}

actionable_elements = [
    {
    "tag": element["tag"],
    "text": element["text"],
    "id": element["id"],
    "children_ids": [child["id"] for child in element.get("children", [])],
    "parent_id": element.get("parentID")
    }
    for element in elements_map
    if element["tag"].lower() in actionable_tags
]

print("actionable elements", actionable_elements)
print("actionable elements count", len(actionable_elements))


try:
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": f"Identify the intent of the user from their task: {user_task}. Score actionable elements based on their relevance to the user's intent. Return only a JSON where each actionable element is assigned an intent_relevance score (between 0 and 1, 0 being least relevant and 1 being more relevant to intent) along with all its other properties. \n{json.dumps(actionable_elements)}"}
        ],
        temperature=0 
    )

    print("response", response)
    output_data = response.choices[0].message.content
    output_json = json.loads(output_data)

except Exception as e:
    print(f"Error calling GPT API: {e}")
    output_json  = {"actionable_elements": []}  


print("output dataa", output_data)
print("output JSON", output_json)

for element in elements_map:
    matching_element = next((e for e in output_json.get("actionable_elements", []) if e["id"] == element["id"]), None)
    if matching_element:
        element["score"] = matching_element["intent_relevance"]

'''

'''
def update_parent_relevance(element):
    """Recursively update parent relevance if any child is relevant."""
    if "parentID" in element and element["parentID"] in parent_map:
        parent = parent_map[element["parentID"]]
        parent["relevant"] = True
        parent["score"] = max(parent["score"], element["score"])
        update_parent_relevance(parent) 

# if any child is relevant, make parent relevant

for element in elements_map:
    if element["relevant"]:
        update_parent_relevance(element)'
'''
        
       