#!/usr/bin/env python3
"""Score LongMemEval results using OpenAI models (official protocol).
Usage: python3 score_openai.py <results_file.jsonl> [--model gpt-4o] [--field-pred predicted_answer]

Follows the official LongMemEval evaluation protocol from:
https://github.com/xiaowu0162/LongMemEval/blob/main/src/evaluation/evaluate_qa.py
"""
import json, sys, os, time
from collections import defaultdict
from openai import OpenAI

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


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("input_file")
    parser.add_argument("--model", default="gpt-4o")
    parser.add_argument("--field-pred", default="predicted_answer")
    parser.add_argument("--field-gold", default="gold_answer")
    parser.add_argument("--field-qtype", default="question_type")
    parser.add_argument("--field-q", default="question")
    args = parser.parse_args()

    client = OpenAI()
    model = args.model
    
    with open(args.input_file) as f:
        results = [json.loads(line) for line in f if line.strip()]
    
    print(f"Scoring {len(results)} questions with {model}")
    
    cats = defaultdict(lambda: [0, 0])
    scored = []
    errors = 0
    
    for i, r in enumerate(results):
        pred = str(r.get(args.field_pred, ""))
        gold = str(r.get(args.field_gold, ""))
        qtype = r.get(args.field_qtype, "unknown")
        question = r.get(args.field_q, "")
        qid = r.get("question_id", "")
        
        prompt = build_prompt(question, gold, pred, qtype, qid)
        
        for attempt in range(3):
            try:
                completion = client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0,
                    max_tokens=10,
                )
                eval_response = completion.choices[0].message.content.strip().lower()
                correct = "yes" in eval_response
                break
            except Exception as e:
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                print(f"  [{i+1}] Error after 3 retries: {e}")
                correct = False
                errors += 1
        
        cats[qtype][0 if correct else 1] += 1
        r[f"{model}_judge"] = correct
        scored.append(r)
        
        if (i + 1) % 50 == 0:
            total_correct = sum(v[0] for v in cats.values())
            total = sum(v[0] + v[1] for v in cats.values())
            print(f"  [{i+1}/{len(results)}] Running: {total_correct/total*100:.1f}%")
    
    # Print results
    print(f"\n{'=' * 60}")
    print(f"{model} Judge — {args.input_file}")
    print(f"{'=' * 60}")
    
    total_correct = 0
    total_count = 0
    for qtype in sorted(cats.keys()):
        correct_count = cats[qtype][0]
        wrong_count = cats[qtype][1]
        total = correct_count + wrong_count
        total_correct += correct_count
        total_count += total
        pct = correct_count / total * 100 if total else 0
        print(f"  {qtype:42s}: {pct:5.1f}% ({correct_count}/{total})")
    
    overall_pct = total_correct / total_count * 100 if total_count else 0
    print(f"\n  {'Overall':42s}: {overall_pct:5.1f}% ({total_correct}/{total_count})")
    if errors:
        print(f"  Errors: {errors}")
    print(f"{'=' * 60}")
    
    # Save scored file
    out_file = f"{args.input_file}.{model}-scored.jsonl"
    with open(out_file, 'w') as f:
        for r in scored:
            f.write(json.dumps(r) + '\n')
    print(f"Saved to {out_file}")


if __name__ == "__main__":
    main()
