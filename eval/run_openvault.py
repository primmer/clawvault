#!/usr/bin/env python3
"""OpenVault LongMemEval baseline — uses bulk import for speed."""
import json, os, sys, time, subprocess, shutil, tempfile, ijson, urllib.request

DATA_DIR = os.path.join(os.path.dirname(__file__), "LongMemEval", "data")
RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
OPENVAULT = os.path.expanduser("~/OpenVault/dist/cli.js")
VAULT_PATH = "/tmp/openvault-eval"
os.makedirs(RESULTS_DIR, exist_ok=True)

# Load creds
cred_file = os.path.expanduser("~/.openclaw/.credentials.env")
if os.path.exists(cred_file):
    with open(cred_file) as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                k, v = line.replace('export ', '').split('=', 1)
                os.environ[k.strip()] = v.strip().strip('"').strip("'")

def gemini_generate(prompt, max_tokens=200):
    key = os.environ["GEMINI_API_KEY"]
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={key}"
    body = json.dumps({"contents": [{"parts": [{"text": prompt}]}],
                        "generationConfig": {"maxOutputTokens": max_tokens}}).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    for attempt in range(3):
        try:
            resp = urllib.request.urlopen(req, timeout=30)
            data = json.loads(resp.read())
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception as e:
            if attempt == 2: return f"Error: {e}"
            time.sleep(2)

def init_vault():
    if os.path.exists(VAULT_PATH):
        shutil.rmtree(VAULT_PATH)
    subprocess.run(["node", OPENVAULT, "init", "--path", VAULT_PATH],
                   capture_output=True, text=True, timeout=10)

def bulk_ingest(sessions, dates):
    """Write all session messages as JSONL, pipe to openvault import."""
    lines = []
    for i, sess in enumerate(sessions):
        date = dates[i] if i < len(dates) else "unknown"
        messages = sess if isinstance(sess, list) else sess.get("messages", [])
        for msg in messages:
            content = msg.get("content", "") if isinstance(msg, dict) else str(msg)
            if not content or len(content.strip()) < 10:
                continue
            role = msg.get("role", "user") if isinstance(msg, dict) else "user"
            text = f"[{date}] [{role}]: {content}"[:2000]
            lines.append(json.dumps({"text": text, "category": "fact"}))
    
    if not lines:
        return 0
    
    proc = subprocess.run(
        ["node", OPENVAULT, "import", "--path", VAULT_PATH],
        input="\n".join(lines), capture_output=True, text=True, timeout=120
    )
    # Parse "Imported N memories"
    out = proc.stdout.strip()
    try:
        return int(out.split("Imported ")[1].split(" ")[0])
    except:
        return 0

def search(query, limit=10):
    result = subprocess.run(
        ["node", OPENVAULT, "search", query, "--limit", str(limit), "--path", VAULT_PATH],
        capture_output=True, text=True, timeout=60
    )
    return result.stdout.strip() if result.stdout else ""

def stream_questions(filepath):
    with open(filepath, 'rb') as f:
        for item in ijson.items(f, 'item'):
            yield item

def main():
    data_file = os.path.join(DATA_DIR, "longmemeval_s_cleaned.json")
    output_file = os.path.join(RESULTS_DIR, "openvault-baseline-answers.jsonl")

    done_ids = set()
    if os.path.exists(output_file):
        with open(output_file) as f:
            for line in f:
                if line.strip():
                    done_ids.add(json.loads(line)["question_id"])
        print(f"Resuming: {len(done_ids)} already done")

    done = len(done_ids)
    print(f"Starting OpenVault LongMemEval baseline...", flush=True)

    for q in stream_questions(data_file):
        qid = q["question_id"]
        if qid in done_ids: continue

        category = q.get("question_type", "unknown")
        question = q["question"]
        gold = q.get("answer", "")
        sessions = q.get("haystack_sessions", [])
        dates = q.get("haystack_dates", [])

        # Fresh vault per question
        init_vault()

        # Bulk ingest
        t0 = time.time()
        writes = bulk_ingest(sessions, dates)
        t_ingest = time.time() - t0

        # Search
        t0 = time.time()
        context = search(question)
        t_search = time.time() - t0

        # Generate answer
        if context:
            prompt = f"""Based on the following retrieved memories, answer the question concisely in 1-2 sentences.

Memories:
{context[:3000]}

Question: {question}

Answer (be specific and concise):"""
            answer = gemini_generate(prompt)
        else:
            answer = "No relevant information found."

        done += 1
        result = {
            "question_id": qid, "category": category,
            "question": question, "gold_answer": gold,
            "prediction": answer, "writes": writes,
            "ingest_s": round(t_ingest, 2), "search_s": round(t_search, 2),
        }

        with open(output_file, "a") as fout:
            fout.write(json.dumps(result) + "\n")

        print(f"  [{done}/500] ({category}) w={writes} i={t_ingest:.1f}s s={t_search:.1f}s | {question[:50]}...", flush=True)

    print(f"\nDone! Results: {output_file}")

if __name__ == "__main__":
    main()
