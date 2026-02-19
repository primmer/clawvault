import json
import os
import time
import urllib.request

OLLAMA_URL = 'http://localhost:11434'


def _default_backend():
    if os.environ.get('GEMINI_API_KEY'):
        return 'gemini'
    if os.environ.get('XAI_API_KEY'):
        return 'xai'
    return 'ollama'


class MemorySystem:
    name = "base"

    def setup(self):
        pass

    def ingest_session(self, session_id, messages, date):
        raise NotImplementedError

    def finalize_ingest(self):
        pass

    def query(self, question, question_date=None, haystack_session_ids=None):
        raise NotImplementedError

    def teardown(self):
        pass

    def ollama_generate(self, prompt, model='llama3.1:8b', max_tokens=300, backend=None):
        """Generate using configured backend (gemini/xai/ollama)."""
        backend = backend or os.environ.get('LLM_BACKEND', _default_backend())
        if backend == 'gemini':
            return self._gemini_generate(prompt, max_tokens)
        elif backend == 'xai':
            return self._xai_generate(prompt, max_tokens)
        return self._ollama_generate(prompt, model, max_tokens)

    def _ollama_generate(self, prompt, model='llama3.1:8b', max_tokens=300):
        data = json.dumps({
            'model': model,
            'prompt': prompt,
            'stream': False,
            'options': {'num_predict': max_tokens, 'temperature': 0}
        }).encode()
        req = urllib.request.Request(
            f'{OLLAMA_URL}/api/generate',
            data=data,
            headers={'Content-Type': 'application/json'}
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                result = json.loads(resp.read())
                return result.get('response', '').strip()
        except Exception as e:
            return f"Error: {e}"

    def _gemini_generate(self, prompt, max_tokens=300):
        import google.generativeai as genai
        genai.configure(api_key=os.environ['GEMINI_API_KEY'])
        model = genai.GenerativeModel('gemini-2.0-flash')
        resp = model.generate_content(prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0, max_output_tokens=max_tokens))
        return resp.text.strip()

    def _xai_generate(self, prompt, max_tokens=300):
        data = json.dumps({
            'model': 'grok-3-mini-fast',
            'messages': [{'role': 'user', 'content': prompt}],
            'max_tokens': max_tokens,
            'temperature': 0
        }).encode()
        req = urllib.request.Request(
            'https://api.x.ai/v1/chat/completions',
            data=data,
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {os.environ["XAI_API_KEY"]}'
            }
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())
            return result['choices'][0]['message']['content'].strip()
