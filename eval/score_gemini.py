#!/usr/bin/env python3
"""Score LongMemEval results using Gemini 2.0 Flash (official protocol prompts).
Usage: python3 score_gemini.py <results_file.jsonl>
"""
import json, sys, os, time, urllib.request
from collections import defaultdict

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}"

# Per-type scoring prompts (exact match to official evaluate_qa.py)
PROMPTS = {
    "single-session-user": "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no.",
    "single-session-assistant": "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no.",
    "multi-session": "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no.",
    "temporal-reasoning": "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct.",
    "knowledge-update": "I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.",
    "single-session-preference": "I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.",
}

ABSTENTION_PROMPT = "I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not."


def build_prompt(question, gold, response, qtype, qid):
    if "_abs" in qid:
        return f"{ABSTENTION_PROMPT}\n\nQuestion: {question}\n\nExplanation: {gold}\n\nModel Response: {response}\n\nDoes the model correctly identify the question as unanswerable? Answer yes or no only."
    if qtype == "single-session-preference":
        return f"{PROMPTS[qtype]}\n\nQuestion: {question}\n\nRubric: {gold}\n\nModel Response: {response}\n\nIs the model response correct? Answer yes or no only."
    prompt_base = PROMPTS.get(qtype, PROMPTS["single-session-user"])
    return f"{prompt_base}\n\nQuestion: {question}\n\nCorrect Answer: {gold}\n\nModel Response: {response}\n\nIs the model response correct? Answer yes or no only."


def gemini_judge(prompt):
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0, "maxOutputTokens": 10}
    }).encode()
    req = urllib.request.Request(GEMINI_URL, data=payload, headers={"Content-Type": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read())
            text = data["candidates"][0]["content"]["parts"][0]["text"].strip().lower()
            return "yes" in text
        except Exception as e:
            if attempt < 2 and ("429" in str(e) or "500" in str(e) or "503" in str(e)):
                time.sleep(2 ** attempt)
                continue
            raise


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 score_gemini.py <file.jsonl>")
        sys.exit(1)

    input_file = sys.argv[1]
    with open(input_file) as f:
        results = [json.loads(line) for line in f if line.strip()]

    print(f"Scoring {len(results)} questions with Gemini 2.0 Flash")

    cats = defaultdict(lambda: [0, 0])
    scored = []
    errors = 0

    for i, r in enumerate(results):
        pred = str(r.get("predicted_answer", ""))
        gold = str(r.get("gold_answer", ""))
        qtype = r.get("question_type", "unknown")
        question = r.get("question", "")
        qid = r.get("question_id", "")

        prompt = build_prompt(question, gold, pred, qtype, qid)
        try:
            correct = gemini_judge(prompt)
        except Exception as e:
            print(f"  [{i+1}] Error: {e}")
            correct = False
            errors += 1

        cats[qtype][0 if correct else 1] += 1
        r["gemini_judge"] = correct
        scored.append(r)

        if (i + 1) % 50 == 0:
            total_correct = sum(v[0] for v in cats.values())
            total = sum(v[0] + v[1] for v in cats.values())
            print(f"  [{i+1}/{len(results)}] Running: {total_correct/total*100:.1f}%")

    # Print results
    print(f"\n{'=' * 60}")
    print(f"Gemini 2.0 Flash Judge — {input_file}")
    print(f"{'=' * 60}")

    total_correct = 0
    total_count = 0
    for qtype in sorted(cats.keys()):
        c = cats[qtype][0]
        w = cats[qtype][1]
        t = c + w
        total_correct += c
        total_count += t
        print(f"  {qtype:42s}: {c/t*100:5.1f}% ({c}/{t})")

    print(f"\n  {'Overall':42s}: {total_correct/total_count*100:5.1f}% ({total_correct}/{total_count})")
    if errors:
        print(f"  Errors: {errors}")
    print(f"{'=' * 60}")

    out_file = f"{input_file}.gemini-scored.jsonl"
    with open(out_file, 'w') as f:
        for r in scored:
            f.write(json.dumps(r) + '\n')
    print(f"Saved to {out_file}")


if __name__ == "__main__":
    main()
