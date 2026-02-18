import json
import urllib.request

OLLAMA_URL = "http://localhost:11434"

class MemorySystem:
    name = "base"
    def setup(self): pass
    def ingest_session(self, session_id, messages, date): pass
    def finalize_ingest(self): pass
    def query(self, question, question_date=None, haystack_session_ids=None): pass
    def teardown(self): pass

    def ollama_generate(self, prompt, model="llama3.1:8b", max_tokens=500):
        payload = json.dumps({
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.1, "num_predict": max_tokens}
        }).encode()
        req = urllib.request.Request(
            f"{OLLAMA_URL}/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
        return data.get("response", "").strip()
