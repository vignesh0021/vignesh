"""Provider-agnostic vision-LLM access. All options here have a FREE path.

Pick with env var  LLM_PROVIDER = ollama | gemini | groq | openrouter | none
  ollama      fully local & free  (default). Needs `ollama serve` +
              `ollama pull llama3.2-vision`  (or llava / qwen2.5-vl).
  gemini      Google AI Studio free tier. GEMINI_API_KEY, vision built in.
  groq        Groq free tier. GROQ_API_KEY, model llama-3.2-90b-vision-preview.
  openrouter  many free vision models. OPENROUTER_API_KEY.
  none        skip the LLM, use the deterministic fallback spec.

Every provider exposes analyze(image_b64, prompt) -> str (model text).
"""
from __future__ import annotations
import os, base64, json, requests

TIMEOUT = 120


def _provider() -> str:
    return os.getenv("LLM_PROVIDER", "ollama").strip().lower()


def available() -> dict:
    p = _provider()
    ok = {
        "ollama": True,  # assume local daemon; verified at call time
        "gemini": bool(os.getenv("GEMINI_API_KEY")),
        "groq": bool(os.getenv("GROQ_API_KEY")),
        "openrouter": bool(os.getenv("OPENROUTER_API_KEY")),
        "none": True,
    }.get(p, False)
    return {"provider": p, "configured": ok}


# --------------------------------------------------------------------------
def analyze(image_b64: str, prompt: str) -> str:
    p = _provider()
    if p == "ollama":
        return _ollama(image_b64, prompt)
    if p == "gemini":
        return _gemini(image_b64, prompt)
    if p == "groq":
        return _groq(image_b64, prompt)
    if p == "openrouter":
        return _openrouter(image_b64, prompt)
    raise RuntimeError("LLM_PROVIDER=none — no model configured")


def _ollama(image_b64, prompt):
    host = os.getenv("OLLAMA_HOST", "http://localhost:11434")
    model = os.getenv("OLLAMA_MODEL", "llama3.2-vision")
    r = requests.post(f"{host}/api/generate", timeout=TIMEOUT, json={
        "model": model, "prompt": prompt, "images": [image_b64],
        "stream": False, "options": {"temperature": 0.1},
    })
    r.raise_for_status()
    return r.json().get("response", "")


def _gemini(image_b64, prompt):
    key = os.environ["GEMINI_API_KEY"]
    model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{model}:generateContent?key={key}")
    r = requests.post(url, timeout=TIMEOUT, json={
        "contents": [{"parts": [
            {"text": prompt},
            {"inline_data": {"mime_type": "image/png", "data": image_b64}},
        ]}],
        "generationConfig": {"temperature": 0.1},
    })
    r.raise_for_status()
    return r.json()["candidates"][0]["content"]["parts"][0]["text"]


def _groq(image_b64, prompt):
    key = os.environ["GROQ_API_KEY"]
    model = os.getenv("GROQ_MODEL", "llama-3.2-90b-vision-preview")
    r = requests.post("https://api.groq.com/openai/v1/chat/completions",
                      timeout=TIMEOUT,
                      headers={"Authorization": f"Bearer {key}"},
                      json={"model": model, "temperature": 0.1, "messages": [
                          {"role": "user", "content": [
                              {"type": "text", "text": prompt},
                              {"type": "image_url", "image_url":
                                  {"url": f"data:image/png;base64,{image_b64}"}},
                          ]}]})
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def _openrouter(image_b64, prompt):
    key = os.environ["OPENROUTER_API_KEY"]
    model = os.getenv("OPENROUTER_MODEL", "qwen/qwen2.5-vl-72b-instruct:free")
    r = requests.post("https://openrouter.ai/api/v1/chat/completions",
                      timeout=TIMEOUT,
                      headers={"Authorization": f"Bearer {key}"},
                      json={"model": model, "temperature": 0.1, "messages": [
                          {"role": "user", "content": [
                              {"type": "text", "text": prompt},
                              {"type": "image_url", "image_url":
                                  {"url": f"data:image/png;base64,{image_b64}"}},
                          ]}]})
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]
