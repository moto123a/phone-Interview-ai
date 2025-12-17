import os
import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

app = FastAPI()

# CORS (keep open while testing)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")

# This header bypasses ngrok browser warning / protection in many cases
NGROK_BYPASS_HEADERS = {
    "ngrok-skip-browser-warning": "1",
}

class AnswerReq(BaseModel):
    transcript: str
    resume: str | None = ""
    answer_tone: str | None = "medium"

@app.get("/health")
def health():
    return {"ok": True, "ollama_base_url": OLLAMA_BASE_URL, "ollama_model": OLLAMA_MODEL}

@app.get("/api/ollama/tags")
def ollama_tags():
    """
    Quick test from your Render backend to your laptop Ollama through ngrok.
    """
    try:
        r = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=15, headers=NGROK_BYPASS_HEADERS)
        return JSONResponse(status_code=r.status_code, content=r.json())
    except requests.RequestException as e:
        return JSONResponse(status_code=500, content={"error": str(e), "hint": "Check ngrok is running and OLLAMA_BASE_URL is correct."})

@app.post("/api/answer")
def generate_answer(req: AnswerReq):
    transcript = (req.transcript or "").strip()
    resume = (req.resume or "").strip()
    tone = (req.answer_tone or "medium").strip().lower()

    if not transcript:
        return {"answer": "No transcript received yet. Speak first, then click Generate Answer."}

    # Prompt
    tone_map = {
        "short": "Give a short, direct interview answer.",
        "medium": "Give a clear, confident interview answer with 2 to 4 strong points.",
        "long": "Give a detailed interview answer with structure, examples, and impact.",
    }
    tone_text = tone_map.get(tone, tone_map["medium"])

    system = (
        "You are an interview copilot. Provide strong, professional answers. "
        "Do not mention you are an AI. Do not add markdown headings."
    )

    user = f"""
{tone_text}

Candidate Resume (optional):
{resume if resume else "[No resume provided]"}

Interviewer Question / Transcript:
{transcript}

Now answer:
""".strip()

    payload = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False
    }

    try:
        r = requests.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json=payload,
            timeout=120,
            headers=NGROK_BYPASS_HEADERS,
        )
        r.raise_for_status()
        data = r.json()

        # Ollama chat returns: { message: { role, content }, ... }
        answer = ""
        if isinstance(data, dict):
            msg = data.get("message") or {}
            answer = (msg.get("content") or "").strip()

        if not answer:
            answer = "Got empty response from Ollama. Try a different model or check Ollama logs."

        return {"answer": answer}

    except requests.HTTPError as e:
        return JSONResponse(
            status_code=500,
            content={
                "error": f"HTTP error from Ollama: {str(e)}",
                "url": f"{OLLAMA_BASE_URL}/api/chat",
                "hint": "Check ngrok URL, Ollama running, and OLLAMA_MODEL exists.",
            },
        )
    except requests.RequestException as e:
        return JSONResponse(
            status_code=500,
            content={
                "error": str(e),
                "url": f"{OLLAMA_BASE_URL}/api/chat",
                "hint": "If backend is on Render, localhost will never work. Use ngrok URL in OLLAMA_BASE_URL and keep ngrok running.",
            },
        )
