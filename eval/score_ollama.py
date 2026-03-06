#!/usr/bin/env python3
"""Score LongMemEval results using local Ollama llama3.1:8b for deterministic judging.
Usage: python3 score_ollama.py <results_file.jsonl> [--field-pred predicted_answer] [--field-gold gold_answer]
"""
import json, sys, os, urllib.request, time
from collections import defaultdict

# LongMemEval scoring prompts (same as Gemini scorer)
PROMPTS = {
    "single-session-user": "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no.",
    "single-session-assistant": "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no.",
    "multi-session": "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no.",
    "temporal-reasoning": "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct.",
    "knowledge-update": "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.",
    "single-session-preference": "I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.",
}

ABSTENTION_PROMPT = "I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not."

def ollama_judge(question, gold, pred, qtype, qid="", temp=0.0):
    # Abstention questions (question_id ends with _abs) use a different prompt
    if "_abs" in qid:
        prompt = f"{ABSTENTION_PROMPT}\n\nQuestion: {question}\n\nExplanation: {gold}\n\nModel Response: {pred}\n\nDoes the model correctly identify the question as unanswerable? Answer yes or no only."
    else:
        prompt_base = PROMPTS.get(qtype, PROMPTS["single-session-user"])
        prompt = f"{prompt_base}\n\nQuestion: {question}\n\nCorrect Answer: {gold}\n\nModel Response: {pred}\n\nIs the model response correct? Answer yes or no only."
    
    payload = json.dumps({
        "model": "llama3.1:8b",
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": temp, "seed": 42, "num_predict": 10}
    }).encode()
    
    req = urllib.request.Request("http://localhost:11434/api/generate", data=payload,
                                 headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req, timeout=60)
    result = json.loads(resp.read())
    answer = result.get("response", "").strip().lower()
    return answer.startswith("yes")

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 score_ollama.py <file.jsonl> [--field-pred X] [--field-gold Y]")
        sys.exit(1)
    
    filepath = sys.argv[1]
    # Parse field names (different result files use different keys)
    pred_field = "predicted_answer"
    gold_field = "gold_answer"
    qtype_field = "question_type"
    q_field = "question"
    
    for i, arg in enumerate(sys.argv):
        if arg == "--field-pred" and i+1 < len(sys.argv): pred_field = sys.argv[i+1]
        if arg == "--field-gold" and i+1 < len(sys.argv): gold_field = sys.argv[i+1]
    
    results = [json.loads(l) for l in open(filepath)]
    print(f"Scoring {len(results)} questions with Ollama llama3.1:8b (temp=0, seed=42)")
    
    cats = defaultdict(lambda: [0, 0])
    scored = []
    
    for i, r in enumerate(results):
        pred = str(r.get(pred_field, ""))
        gold = str(r.get(gold_field, ""))
        qtype = r.get(qtype_field, "unknown")
        question = r.get(q_field, "")
        
        try:
            qid = r.get("question_id", "")
            correct = ollama_judge(question, gold, pred, qtype, qid=qid)
        except Exception as e:
            print(f"  [{i+1}] Error: {e}")
            correct = False
        
        cats[qtype][0 if correct else 1] += 1
        r["ollama_judge"] = correct
        scored.append(r)
        
        if (i+1) % 50 == 0:
            total_c = sum(v[0] for v in cats.values())
            total = sum(v[0]+v[1] for v in cats.values())
            print(f"  [{i+1}/{len(results)}] Running: {total_c/total:.1%}", flush=True)
    
    # Print results
    total_c = sum(v[0] for v in cats.values())
    total = sum(v[0]+v[1] for v in cats.values())
    print(f"\n{'='*60}")
    print(f"Ollama llama3.1:8b Judge — {filepath}")
    print(f"{'='*60}")
    for cat in sorted(cats):
        c, w = cats[cat]
        print(f"  {cat:40s}: {c/(c+w):.1%} ({c}/{c+w})")
    print(f"\n  {'Overall':40s}: {total_c/total:.1%} ({total_c}/{total})")
    print(f"{'='*60}")
    
    # Save scored results
    out = filepath.replace(".jsonl", "-ollama-scored.jsonl")
    with open(out, "w") as f:
        for r in scored:
            f.write(json.dumps(r) + "\n")
    print(f"Saved to {out}")

if __name__ == "__main__":
    main()
