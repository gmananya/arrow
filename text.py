"""
from flask import Flask, request, jsonify
from flask_cors import CORS
import openai
import torch
import bert_score

app = Flask(__name__)
CORS(app)
openai_client = openai.OpenAI(api_key = "" )
bert_score_model = "microsoft/deberta-xlarge-mnli"

def get_openai_embedding(text):
    response = openai_client.embeddings.create(
        model="text-embedding-3-large",
        input=text,
        encoding_format="float"
    )
    return response.data[0].embedding

@app.route('/process_elements', methods=['POST'])
def process_elements():
    try:
        data = request.json

        user_task = data.get('task', "")
        elements_map = data.get('elementsMap', [])  

        print("Received data:", user_task, len(elements_map))

        if not user_task or not elements_map:
            return jsonify({"error": "Invalid input"}), 400

        text_elements = [item.get("text", "").strip() for item in elements_map if item.get("text", "").strip()]
        print("Text elements:", text_elements[:10])

        if not text_elements:
            return jsonify({"error": "All elements are empty"}), 400
        print("hello 0")
        task_embedding = torch.tensor(get_openai_embedding(user_task))
        text_embeddings = [torch.tensor(get_openai_embedding(text)) for text in text_elements]
        print("hello 1")
        if len(text_embeddings) != len(elements_map):
            return jsonify({"error": "Mismatch in number of text elements and elements map"}), 400
        print("hello 2")
        sbert_scores = [torch.nn.functional.cosine_similarity(task_embedding, text_emb, dim=0).item() for text_emb in text_embeddings]
        print("hello 3")

        print("SBERT scores:", sbert_scores[:10])

        P, R, F1 = bert_score.score(text_elements, [user_task] * len(text_elements), model_type=bert_score_model, lang="en")
        bert_scores = F1.tolist()
        print("BERT scores:", bert_scores[:10])

        final_scores = [0.7 * s + 0.3 * b for s, b in zip(sbert_scores, bert_scores)]
        print("Final scores:", final_scores[:10])

        for i, element in enumerate(elements_map):
            if i < len(final_scores):  
                element["sbertScore"] = sbert_scores[i]
                element["bertScore"] = bert_scores[i]
                element["score"] = final_scores[i]
            else:
                element["score"] = 0.0  

        print("Processed elements with scores:", elements_map[:3])
        return jsonify({"elementsMap": elements_map})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)


"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from sentence_transformers import SentenceTransformer, util
import warnings
import gc
from bert_score import BERTScorer
from transformers import BertTokenizer, BertModel

warnings.filterwarnings("ignore", message="Some weights of RobertaModel were not initialized")
warnings.filterwarnings("ignore", category=UserWarning, message=".*resource_tracker.*")


app = Flask(__name__)
CORS(app)  

sbert_model = SentenceTransformer('all-MiniLM-L6-v2')
# bert_score_model = "microsoft/deberta-xlarge-mnli"

@app.route('/process_elements', methods=['POST'])
def process_elements():
    data = request.json
    user_task = data.get('task', "")
    elements_map = data.get('elementsMap', [])  
    print("Received data:", user_task, len(elements_map))

    if not user_task or not elements_map:
        print("Invalid input: missing task or elementsMap")
        return jsonify({"error": "Invalid input"}), 400

    text_elements = [item.get("text", "").strip() for item in elements_map if item.get("text", "").strip()]
    # print("Text elements:", text_elements[:10])

    if not text_elements:
        print("No valid text elements found")
        return jsonify({"error": "All elements are empty"}), 400
    
    task_embedding = sbert_model.encode(user_task, convert_to_tensor=True)
    text_embeddings = sbert_model.encode(text_elements, convert_to_tensor=True)
    sbert_scores = util.pytorch_cos_sim(task_embedding, text_embeddings).squeeze().tolist()
    print("SBERT scores:", sbert_scores[:10])

    scorer = BERTScorer(model_type='roberta-large', lang='en')
    P, R, F1 = scorer.score(text_elements, [user_task] * len(text_elements))
    print(f"BERTScore precision: P={P.mean():.6f}, recall: R={R.mean():.6f}, F1={F1.mean():.6f}")
    bert_scores = F1.tolist()

    # P, R, F1 = bert_score.score(text_elements, [user_task] * len(text_elements), model_type=bert_score_model, lang="en", batch_size=8)
    # bert_scores = F1.tolist()
    # print("BERT scores:", bert_scores[:10])

    final_scores = [0.7 * s + 0.3 * b for s, b in zip(sbert_scores, bert_scores)]
    print("Final scores:", final_scores[:10])

    for i, element in enumerate(elements_map):
        element["sbertScore"] = sbert_scores[i]
        element["bertScore"] = bert_scores[i]
        element["score"] = final_scores[i] if i < len(final_scores) else 0.0

    # print("Processed elements with scores:", elements_map[:3])

    gc.collect()

    return jsonify({"elementsMap": elements_map})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)


