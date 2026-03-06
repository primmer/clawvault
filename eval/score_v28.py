#!/usr/bin/env python3
"""Score v28 multi-session results using Gemini as judge."""
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(__file__))
from adapters.base import MemorySystem

# Use Gemini for scoring
api_key = os.environ.get("GEMINI_API_KEY", "")


def gemini_judge(question, gold_answer, predicted_answer):
    """Ask Gemini if the predicted answer is correct."""
    prompt = (
        "I will give you a question, a correct answer, and a response from a model. "
        "Please answer yes if the response contains the correct answer. Otherwise, answer no. "
        "If the response is equivalent to the correct answer or contains all the intermediate "
        "steps to get the correct answer, you should also answer yes. "
        "If the response only contains a subset of the information required by the answer, answer no.\n\n"
        f"Question: {question}\n\n"
        f"Correct Answer: {gold_answer}\n\n"
        f"Model Response: {predicted_answer}\n\n"
        "Is the model response correct? Answer yes or no only."
    )
    
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.0, "maxOutputTokens": 10}
    }).encode()
    headers = {
        "Content-Type": "application/json",
        "x-goog-api-key": api_key,
    }
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
    results_file = os.path.join(os.path.dirname(__file__), "results", "v28-multi-answers.jsonl")
    
    results = []
    with open(results_file) as f:
        for line in f:
            if line.strip():
                results.append(json.loads(line))
    
    print(f"Scoring {len(results)} v28 multi-session answers...")
    
    correct = 0
    total = 0
    
    for i, r in enumerate(results):
        is_correct = gemini_judge(r["question"], str(r["gold_answer"]), r["predicted_answer"])
        r["score"] = 1 if is_correct else 0
        correct += r["score"]
        total += 1
        
        if (i + 1) % 20 == 0:
            print(f"  [{i+1}/{len(results)}] Running accuracy: {correct/total*100:.1f}%")
    
    accuracy = correct / total * 100
    print(f"\n{'='*60}")
    print(f"v28 Multi-Session Results")
    print(f"{'='*60}")
    print(f"  Accuracy: {accuracy:.1f}% ({correct}/{total})")
    print(f"  Baseline (v25): 28.6% (38/133)")
    print(f"  Delta: {accuracy - 28.6:+.1f}pp")
    print(f"{'='*60}")
    
    # Save scored results
    scored_file = results_file + ".scored"
    with open(scored_file, "w") as f:
        for r in results:
            f.write(json.dumps(r) + "\n")
    print(f"Scored results saved to {scored_file}")


if __name__ == "__main__":
    main()
