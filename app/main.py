import os
from fastapi import FastAPI
from pydantic import BaseModel
import httpx

# vLLM service lives inside the cluster. We never expose it publicly.
MODEL_BASE_URL = os.getenv("MODEL_BASE_URL", "http://vllm:8000")
MODEL_NAME = os.getenv("MODEL_NAME", "meta-llama/Llama-3-8b-instruct")

app = FastAPI()

class ChatIn(BaseModel):
    messages: list[dict]  # e.g., [{"role":"user","content":"Hi!"}]
    max_tokens: int = 256
    temperature: float = 0.5

@app.get("/healthz")
def healthz():
    return {"ok": True}

@app.post("/chat")
async def chat(inp: ChatIn):
    payload = {
        "model": MODEL_NAME,
        "messages": inp.messages,
        "max_tokens": inp.max_tokens,
        "temperature": inp.temperature
    }
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(f"{MODEL_BASE_URL}/v1/chat/completions", json=payload)
        r.raise_for_status()
        return r.json()
