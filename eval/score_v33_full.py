#!/usr/bin/env python3
"""Score v33 full 500-question results using Gemini as judge."""
import json
import os
import sys
import time
import urllib.request
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))

api_key = os.environ.get("GEMINI_API_KEY", "")

# LongMemEval scoring prompts per task type
PROMPTS = {
    "single-session-user": "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no.",
    "single-session-assistant": "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no.",
    "multi-session": "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no.",
    "temporal-reasoning": "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct.",
    "knowledge-update": "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.",
    "single-session-preference": "I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.",
}


def gemini_judge(question, gold_answer, predicted_answer, question_type):
    base_prompt = PROMPTS.get(question_type, PROMPTS["single-session-user"])
    prompt = f"{base_prompt}\n\nQuestion: {question}\n\nCorrect Answer: {gold_answer}\n\nModel Response: {predicted_answer}\n\nIs the model response correct? Answer yes or no only."

    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.0, "maxOutputTokens": 10}
    }).encode()
    headers = {"Content-Type": "application/json", "x-goog-api-key": api_key}
    req = urllib.request.Request(url, data=payload, headers=headers)

    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
            text = data["candidates"][0]["content"]["parts"][0]["text"].strip().lower()
            return "yes" in text
        except Exception as e:
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            print(f"  Scoring error: {e}")
            return False


def main():
    results_file = os.path.join(os.path.dirname(__file__), "results", "v33-full-answers.jsonl")

    results = []
    with open(results_file) as f:
        for line in f:
            if line.strip():
                results.append(json.loads(line))

    print(f"Scoring {len(results)} v33 full answers...")

    category_correct = defaultdict(int)
    category_total = defaultdict(int)
    total_correct = 0

    for i, r in enumerate(results):
        is_correct = gemini_judge(r["question"], str(r["gold_answer"]), r["predicted_answer"], r["question_type"])
        r["score"] = 1 if is_correct else 0
        category_correct[r["question_type"]] += r["score"]
        category_total[r["question_type"]] += 1
        total_correct += r["score"]

        if (i + 1) % 20 == 0:
            print(f"  [{i+1}/{len(results)}] Running accuracy: {total_correct/(i+1)*100:.1f}%")

    print(f"\n{'='*60}")
    print(f"LongMemEval Results — ClawVault v33 (hybrid BM25+semantic+RRF)")
    print(f"{'='*60}")
    for cat in sorted(category_total.keys()):
        c = category_correct[cat]
        t = category_total[cat]
        print(f"  {cat:40s}: {c/t*100:5.1f}% ({c}/{t})")
    print()
    print(f"  {'Overall accuracy':40s}: {total_correct/len(results)*100:.1f}% ({total_correct}/{len(results)})")

    # Task-averaged
    task_accs = [category_correct[c]/category_total[c] for c in category_total]
    print(f"  {'Task-averaged accuracy':40s}: {sum(task_accs)/len(task_accs)*100:.1f}%")
    print(f"\n  Previous best (v25): 52.6% overall")
    print(f"{'='*60}")

    scored_file = results_file + ".scored"
    with open(scored_file, "w") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")
    print(f"Scored results saved to {scored_file}")


if __name__ == "__main__":
    main()
