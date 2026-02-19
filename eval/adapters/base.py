import json
import os
import time
import urllib.request

OLLAMA_URL = "http://localhost:11434"

# LLM backend: set LLM_BACKEND=gemini|xai|ollama (default: gemini if key available)
def _default_backend():
    if os.environ.get("GEMINI_API_KEY"):
        return "gemini"
    if os.environ.get("XAI_API_KEY"):
        return "xai"
    return "ollama"

class MemorySystem:
    name = "base"
    def setup(self): pass
    def ingest_session(self, session_id, messages, date): pass
    def finalize_ingest(self): pass
    def query(self, question, question_date=None, haystack_session_ids=None): pass
    def teardown(self): pass

    def ollama_generate(self, prompt, model=None, max_tokens=500):
        """Generate using configured backend (gemini/xai/ollama)."""
        backend = os.environ.get("LLM_BACKEND", _default_backend())
        if backend == "gemini":
            return self._gemini_generate(prompt, max_tokens=max_tokens)
        elif backend == "xai":
            return self._xai_generate(prompt, max_tokens=max_tokens)
        else:
            return self._ollama_generate(prompt, model or "llama3.1:8b", max_tokens)

    def _ollama_generate(self, prompt, model="llama3.1:8b", max_tokens=500):
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
        with urllib.request.urlopen(req, timeout=600) as resp:
            data = json.loads(resp.read())
        return data.get("response", "").strip()

    def _gemini_generate(self, prompt, max_tokens=500):
        api_key = os.environ["GEMINI_API_KEY"]
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
        payload = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.1, "maxOutputTokens": max_tokens}
        }).encode()
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    data = json.loads(resp.read())
                return data["candidates"][0]["content"]["parts"][0]["text"].strip()
            except Exception as e:
                if attempt < 2 and ("429" in str(e) or "500" in str(e) or "503" in str(e)):
                    time.sleep(2 ** attempt)
                    continue
                raise

    def _xai_generate(self, prompt, max_tokens=500):
        api_key = os.environ["XAI_API_KEY"]
        url = "https://api.x.ai/v1/chat/completions"
        payload = json.dumps({
            "model": "grok-3-mini",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.1,
            "max_tokens": max_tokens
        }).encode()
        req = urllib.request.Request(url, data=payload,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    data = json.loads(resp.read())
                return data["choices"][0]["message"]["content"].strip()
            except Exception as e:
                if attempt < 2 and ("429" in str(e) or "500" in str(e) or "503" in str(e)):
                    time.sleep(2 ** attempt)
                    continue
                raise
