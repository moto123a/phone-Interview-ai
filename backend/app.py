from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import requests
import tempfile
import os
import uuid
from typing import Dict

from faster_whisper import WhisperModel

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ok for testing
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------
# Serve Frontend
# ----------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/")
def root():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

@app.get("/health")
def health():
    return {"ok": True, "service": "phone-interview-ai"}

# ----------------------------
# Whisper STT
# ----------------------------
MODEL_CACHE: Dict[str, WhisperModel] = {}

WHISPER_DEVICE = "cpu"
WHISPER_COMPUTE = "int8"

SUPPORTED_WHISPER_MODELS = [
    "base",
    "small",
    "medium",
    "large-v3-turbo",
    "large-v3",
]

def get_whisper(model_name: str) -> WhisperModel:
    name = (model_name or "").strip()
    if name not in SUPPORTED_WHISPER_MODELS:
        name = "base"
    if name in MODEL_CACHE:
        return MODEL_CACHE[name]
    m = WhisperModel(name, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE)
    MODEL_CACHE[name] = m
    return m

SESSIONS: Dict[str, Dict] = {}

def new_session() -> str:
    sid = str(uuid.uuid4())
    SESSIONS[sid] = {"text": "", "last_chunk": -1}
    return sid

@app.get("/stt/models")
def stt_models():
    return {"models": SUPPORTED_WHISPER_MODELS}

@app.post("/stt/session")
def stt_session():
    return {"session_id": new_session()}

@app.post("/transcribe_chunk")
async def transcribe_chunk(
    audio: UploadFile = File(...),
    session_id: str = Form(...),
    chunk_index: int = Form(...),
    model: str = Form("base"),
    language: str = Form("en"),
):
    if not session_id or session_id not in SESSIONS:
        session_id = new_session()

    sess = SESSIONS[session_id]

    if chunk_index <= sess["last_chunk"]:
        return {"session_id": session_id, "text": sess["text"], "partial": ""}

    filename = (audio.filename or "").lower()
    suffix = ".webm"
    if filename.endswith(".wav"):
        suffix = ".wav"
    elif filename.endswith(".mp3"):
        suffix = ".mp3"
    elif filename.endswith(".m4a"):
        suffix = ".m4a"
    elif filename.endswith(".ogg"):
        suffix = ".ogg"

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp_path = tmp.name
        tmp.write(await audio.read())

    try:
        whisper = get_whisper(model)
        segments, _info = whisper.transcribe(
            tmp_path,
            language=language if language else None,
            vad_filter=True,
            beam_size=1,
            best_of=1,
            temperature=0.0,
        )

        parts = []
        for seg in segments:
            t = (seg.text or "").strip()
            if t:
                parts.append(t)

        partial_text = " ".join(parts).strip()

        if partial_text:
            sess["text"] = (sess["text"] + " " + partial_text).strip()

        sess["last_chunk"] = chunk_index

        return {"session_id": session_id, "text": sess["text"], "partial": partial_text}
    finally:
        try:
            os.remove(tmp_path)
        except Exception:
            pass

# ----------------------------
# Ollama Answer (local)
# ----------------------------
# IMPORTANT:
# If backend is deployed to Render, this will NOT reach your laptop Ollama.
# For Render + iPhone, you must use a cloud LLM endpoint instead.
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")

class AnswerReq(BaseModel):
    resume: str = ""
    question: str
    model: str = "llama3:latest"
    tone: str = "medium"

def tone_rule(tone: str) -> str:
    t = (tone or "medium").strip().lower()
    if t == "short":
        return "Keep it short (20 to 30 seconds)."
    if t == "detailed":
        return "Make it detailed (60 to 90 seconds) with strong structure."
    return "Keep it concise (30 to 60 seconds)."

@app.get("/ollama/models")
def ollama_models():
    try:
        tags = requests.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=5).json()
        models = [m.get("name") for m in tags.get("models", []) if m.get("name")]
        return {"models": models}
    except Exception:
        return {"models": []}

@app.post("/answer")
def answer(req: AnswerReq):
    question = (req.question or "").strip()
    if not question:
        return {"answer": "No question received."}

    resume = (req.resume or "").strip()

    system = (
        "You are an interview copilot. Give a confident, natural spoken answer. "
        "Structure: direct answer, brief example, close. "
        + tone_rule(req.tone)
    )

    user = f"Question:\n{question}\n"
    if resume:
        user += f"\nResume context:\n{resume}\n"

    payload = {
        "model": req.model or "llama3:latest",
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False
    }

    try:
        r = requests.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload, timeout=120)
        r.raise_for_status()
        data = r.json()
        content = (data.get("message", {}) or {}).get("content", "") or ""
        return {"answer": content.strip() if content else "No answer returned from Ollama."}
    except requests.exceptions.ConnectionError:
        return {
            "answer": (
                "Ollama is not running or not reachable.\n"
                "Fix:\n"
                "1) Install Ollama\n"
                "2) Start it\n"
                "3) Verify: open http://127.0.0.1:11434/api/tags in browser\n"
                "If you are using Render, Ollama on your laptop cannot be used."
            )
        }
    except Exception as e:
        return {"answer": f"Ollama error: {e}"}
