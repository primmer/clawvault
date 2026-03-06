"""
OpenVault adapter for LongMemEval.
Uses OpenVault's search and write via its Node.js modules directly.
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from adapters.base import MemorySystem

OPENVAULT_DIR = os.path.expanduser("~/OpenVault")
VAULT_PATH = "/tmp/openvault-eval"

class OpenVaultSystem(MemorySystem):
    name = "openvault"

    def setup(self):
        # Init a fresh vault for the eval
        subprocess.run(
            ["node", f"{OPENVAULT_DIR}/dist/cli.js", "init", "--path", VAULT_PATH],
            capture_output=True, text=True
        )

    def ingest_session(self, session_id, messages, date):
        # Write each message as a memory
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if not content or len(content.strip()) < 10:
                continue
            # Format: [session_id] [date] [role]: content
            text = f"[Session: {session_id}] [{date}] [{role}]: {content}"
            result = subprocess.run(
                ["node", f"{OPENVAULT_DIR}/dist/cli.js", "write", text,
                 "--category", "fact", "--path", VAULT_PATH],
                capture_output=True, text=True, timeout=30
            )

    def query(self, question, question_date=None, haystack_session_ids=None):
        result = subprocess.run(
            ["node", f"{OPENVAULT_DIR}/dist/cli.js", "search", question,
             "--limit", "10", "--path", VAULT_PATH],
            capture_output=True, text=True, timeout=60
        )
        context = result.stdout.strip() if result.stdout else ""
        if not context:
            return "I don't have information about that."

        # Use LLM to answer based on retrieved context
        prompt = f"""Based on the following memory context, answer the question concisely.

Context:
{context[:3000]}

Question: {question}

Answer:"""
        return self.ollama_generate(prompt, max_tokens=200)

    def teardown(self):
        import shutil
        if os.path.exists(VAULT_PATH):
            shutil.rmtree(VAULT_PATH)
