// Backend is SAME origin because FastAPI serves index.html + /static/script.js
const BACKEND = window.location.origin;

const API_HEALTH = `${BACKEND}/health`;
const API_STT_MODELS = `${BACKEND}/stt/models`;
const API_STT_SESSION = `${BACKEND}/stt/session`;
const API_TRANSCRIBE_CHUNK = `${BACKEND}/transcribe_chunk`;

const API_OLLAMA_MODELS = `${BACKEND}/ollama/models`;
const API_ANSWER = `${BACKEND}/answer`;

function $(id){ return document.getElementById(id); }

// Top pills
const backendPill = $("backendPill");
const sttPill = $("sttPill");
const statusLine = $("statusLine");

// Views
const setupView = $("setupView");
const interviewView = $("interviewView");
const startInterviewBtn = $("startInterviewBtn");
const btnBack = $("btnBack");

// Setup controls
const sttEngine = $("sttEngine");
const engineNote = $("engineNote");
const langSelect = $("langSelect");

const whisperOptions = $("whisperOptions");
const whisperModel = $("whisperModel");
const chunkSec = $("chunkSec");

const webspeechOptions = $("webspeechOptions");
const webspeechSupportLine = $("webspeechSupportLine");

// Setup test STT buttons
const btnTestStart = $("btnTestStart");
const btnTestStop = $("btnTestStop");

// Interview STT buttons
const btnStart = $("btnStart");
const btnStop = $("btnStop");

// Transcript tools
const transcriptEl = $("transcript");
const btnClear = $("btnClear");
const btnCopy = $("btnCopy");

// Answer
const ollamaModel = $("ollamaModel");
const tone = $("tone");
const resume = $("resume");
const btnAnswer = $("btnAnswer");
const btnCopyAns = $("btnCopyAns");
const ansStatus = $("ansStatus");
const answerEl = $("answer");

// ---------- UI helpers ----------
function setPill(el, text, ok=true){
  el.textContent = text;
  el.classList.remove("ok","danger");
  el.classList.add(ok ? "ok" : "danger");
}
function setSTT(text, ok=true){ setPill(sttPill, text, ok); }

function setButtonsRunning(running){
  // Setup test
  btnTestStart.disabled = running;
  btnTestStop.disabled = !running;

  // Interview controls
  btnStart.disabled = running;
  btnStop.disabled = !running;
}

// ---------- Backend ----------
async function checkBackend(){
  try{
    const r = await fetch(API_HEALTH);
    const j = await r.json();
    setPill(backendPill, j.ok ? "Backend: ready" : "Backend: error", !!j.ok);
  }catch{
    setPill(backendPill, "Backend: offline", false);
  }
}

async function loadWhisperModels(){
  whisperModel.innerHTML = "";
  try{
    const r = await fetch(API_STT_MODELS);
    const j = await r.json();
    const models = j.models || [];
    models.forEach(m=>{
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      whisperModel.appendChild(opt);
    });
    whisperModel.value = models.includes("large-v3-turbo") ? "large-v3-turbo" : (models[0] || "base");
  }catch{
    ["base","small","medium","large-v3-turbo","large-v3"].forEach(m=>{
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      whisperModel.appendChild(opt);
    });
    whisperModel.value = "base";
  }
}

async function loadOllamaModels(){
  ollamaModel.innerHTML = "";
  try{
    const r = await fetch(API_OLLAMA_MODELS);
    const j = await r.json();
    const models = j.models || [];
    if(models.length === 0){
      const opt = document.createElement("option");
      opt.value = "llama3:latest";
      opt.textContent = "llama3:latest";
      ollamaModel.appendChild(opt);
      return;
    }
    models.forEach(m=>{
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      ollamaModel.appendChild(opt);
    });
    ollamaModel.value = models.includes("llama3:latest") ? "llama3:latest" : models[0];
  }catch{
    const opt = document.createElement("option");
    opt.value = "llama3:latest";
    opt.textContent = "llama3:latest";
    ollamaModel.appendChild(opt);
  }
}

// ---------- STT Engine: Whisper backend ----------
let mediaRecorder = null;
let audioStream = null;
let sessionId = null;
let chunkIndex = 0;
let whisperRunning = false;

async function startWhisperSession(){
  const r = await fetch(API_STT_SESSION, { method: "POST" });
  const j = await r.json();
  sessionId = j.session_id;
  chunkIndex = 0;
}

async function startWhisperSTT(){
  if(whisperRunning) return;
  whisperRunning = true;

  transcriptEl.textContent = "Starting Whisper STT...";
  statusLine.textContent = "Requesting microphone permission...";
  setSTT("STT: starting", true);

  await startWhisperSession();

  audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const timesliceMs = Number(chunkSec.value) * 1000;

  const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  let chosenMime = "";
  for(const m of mimeCandidates){
    if(window.MediaRecorder && MediaRecorder.isTypeSupported(m)){
      chosenMime = m; break;
    }
  }

  mediaRecorder = new MediaRecorder(audioStream, chosenMime ? { mimeType: chosenMime } : undefined);

  mediaRecorder.onstart = () => {
    setSTT("STT: listening", true);
    statusLine.textContent = "Listening (Whisper)...";
    setButtonsRunning(true);
  };

  mediaRecorder.ondataavailable = async (ev) => {
    if(!whisperRunning) return;
    if(!ev.data || ev.data.size === 0) return;

    setSTT("STT: transcribing", true);

    const fd = new FormData();
    fd.append("audio", ev.data, "chunk.webm");
    fd.append("session_id", sessionId);
    fd.append("chunk_index", String(chunkIndex));
    fd.append("model", whisperModel.value);
    fd.append("language", langSelect.value || "en");

    try{
      const r = await fetch(API_TRANSCRIBE_CHUNK, { method:"POST", body: fd });
      const j = await r.json();
      transcriptEl.textContent = j.text || "";
      statusLine.textContent = j.partial ? `Heard: ${j.partial}` : "Listening...";
      setSTT("STT: listening", true);
    }catch{
      setSTT("STT: error", false);
      statusLine.textContent = "Network error sending audio to backend.";
    }

    chunkIndex += 1;
  };

  mediaRecorder.onstop = () => {
    setSTT("STT: idle", true);
    statusLine.textContent = "Stopped.";
    setButtonsRunning(false);
  };

  mediaRecorder.start(timesliceMs);
}

function stopWhisperSTT(){
  whisperRunning = false;

  try{
    if(mediaRecorder && mediaRecorder.state !== "inactive"){
      mediaRecorder.stop();
    }
  }catch{}

  try{
    if(audioStream){
      audioStream.getTracks().forEach(t=>t.stop());
    }
  }catch{}

  mediaRecorder = null;
  audioStream = null;

  setSTT("STT: idle", true);
  statusLine.textContent = "Stopped.";
  setButtonsRunning(false);
}

// ---------- STT Engine: WebSpeech ----------
let recognition = null;
let webspeechRunning = false;
let finalText = "";
let interimText = "";

function getSpeechRec(){
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function resetWebSpeechText(){
  finalText = "";
  interimText = "";
}

function combinedText(){
  return `${finalText} ${interimText}`.replace(/\s+/g, " ").trim();
}

function startWebSpeechSTT(){
  if(webspeechRunning) return;

  const SR = getSpeechRec();
  if(!SR){
    setSTT("STT: not supported", false);
    statusLine.textContent = "WebSpeech not supported on this device. Use Whisper.";
    return;
  }

  resetWebSpeechText();
  transcriptEl.textContent = "Listening...";
  statusLine.textContent = "Listening (WebSpeech)...";
  setSTT("STT: listening", true);

  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    let interim = "";
    let finalChunk = "";

    for(let i = event.resultIndex; i < event.results.length; i++){
      const r = event.results[i];
      const t = r[0]?.transcript || "";
      if(r.isFinal) finalChunk += t + " ";
      else interim += t;
    }

    if(finalChunk) finalText = (finalText + " " + finalChunk).replace(/\s+/g, " ").trim();
    interimText = interim.trim();

    transcriptEl.textContent = combinedText() || "Listening...";
  };

  recognition.onerror = () => {
    setSTT("STT: error", false);
    statusLine.textContent = "WebSpeech error. Switch to Whisper.";
  };

  recognition.onend = () => {
    webspeechRunning = false;
    recognition = null;
    setSTT("STT: idle", true);
    statusLine.textContent = "Stopped.";
    setButtonsRunning(false);
  };

  try{
    recognition.start();
    webspeechRunning = true;
    setButtonsRunning(true);
  }catch{
    setSTT("STT: cannot start", false);
    statusLine.textContent = "WebSpeech could not start. Switch to Whisper.";
    setButtonsRunning(false);
  }
}

function stopWebSpeechSTT(){
  webspeechRunning = false;
  try{ if(recognition) recognition.stop(); }catch{}
  recognition = null;

  setSTT("STT: idle", true);
  statusLine.textContent = "Stopped.";
  setButtonsRunning(false);
}

// ---------- Engine switching ----------
function isIOS(){
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua);
}

function refreshEngineUI(){
  const engine = sttEngine.value;

  if(engine === "whisper"){
    whisperOptions.classList.remove("hide");
    webspeechOptions.classList.add("hide");
    engineNote.textContent = "Whisper works on iPhone and Android. Near-live using chunks.";
  } else {
    whisperOptions.classList.add("hide");
    webspeechOptions.classList.remove("hide");
    engineNote.textContent = "WebSpeech is instant on Android Chrome and desktop. iPhone usually does not support it.";

    const ok = !!getSpeechRec();
    webspeechSupportLine.textContent = ok
      ? "WebSpeech supported on this device."
      : "WebSpeech NOT supported on this device. Use Whisper.";
  }

  if(isIOS() && sttEngine.value === "webspeech" && !getSpeechRec()){
    webspeechSupportLine.textContent = "iPhone browser does not support WebSpeech. Choose Whisper.";
  }
}

function stopAllSTT(){
  stopWhisperSTT();
  stopWebSpeechSTT();
}

// ---------- Buttons wiring ----------
// Setup test buttons
btnTestStart.addEventListener("click", async () => {
  answerEl.textContent = "Your answer will appear here.";
  ansStatus.textContent = "Answer: ready";

  stopAllSTT();

  const engine = sttEngine.value;
  if(engine === "whisper"){
    try{ await startWhisperSTT(); }
    catch(e){
      setSTT("STT: error", false);
      statusLine.textContent = `Whisper STT failed: ${e}`;
      setButtonsRunning(false);
    }
  } else {
    startWebSpeechSTT();
  }
});

btnTestStop.addEventListener("click", () => {
  stopAllSTT();
});

// Interview buttons
btnStart.addEventListener("click", async () => {
  answerEl.textContent = "Your answer will appear here.";
  ansStatus.textContent = "Answer: ready";

  stopAllSTT();

  const engine = sttEngine.value;
  if(engine === "whisper"){
    try{ await startWhisperSTT(); }
    catch(e){
      setSTT("STT: error", false);
      statusLine.textContent = `Whisper STT failed: ${e}`;
      setButtonsRunning(false);
    }
  } else {
    startWebSpeechSTT();
  }
});

btnStop.addEventListener("click", () => {
  stopAllSTT();
});

btnClear.addEventListener("click", () => {
  transcriptEl.textContent = "";
  resetWebSpeechText();
  statusLine.textContent = "Cleared.";
});

btnCopy.addEventListener("click", async () => {
  const t = (transcriptEl.textContent || "").trim();
  if(!t) return;
  try{
    await navigator.clipboard.writeText(t);
    statusLine.textContent = "Copied transcript.";
  }catch{
    window.prompt("Copy transcript:", t);
  }
});

// ---------- Answer generation ----------
function toneRule(v){
  if(v === "short") return "Keep it very short (20 to 30 seconds).";
  if(v === "detailed") return "Make it detailed (60 to 90 seconds) with strong structure.";
  return "Keep it concise (30 to 60 seconds).";
}

btnAnswer.addEventListener("click", async () => {
  const question = (transcriptEl.textContent || "").trim();
  if(!question){
    ansStatus.textContent = "Answer: transcript empty";
    answerEl.textContent = "Start STT and capture a question first.";
    return;
  }

  ansStatus.textContent = "Answer: thinking";
  answerEl.textContent = "Thinking...";

  try{
    const r = await fetch(API_ANSWER, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        resume: (resume.value || "").trim(),
        question: `${question}\n\nAnswer length rule: ${toneRule(tone.value)}`,
        model: ollamaModel.value || "llama3:latest",
        tone: tone.value || "medium"
      })
    });
    const j = await r.json();
    answerEl.textContent = j.answer || "No answer returned.";
    ansStatus.textContent = "Answer: ready";
  }catch{
    ansStatus.textContent = "Answer: error";
    answerEl.textContent = "Network error calling backend.";
  }
});

btnCopyAns.addEventListener("click", async () => {
  const t = (answerEl.textContent || "").trim();
  if(!t) return;
  try{
    await navigator.clipboard.writeText(t);
    ansStatus.textContent = "Answer: copied";
    setTimeout(()=>ansStatus.textContent="Answer: ready", 700);
  }catch{
    window.prompt("Copy answer:", t);
  }
});

// ---------- View switching ----------
startInterviewBtn.addEventListener("click", () => {
  setupView.classList.add("hide");
  interviewView.classList.remove("hide");
});

btnBack.addEventListener("click", () => {
  interviewView.classList.add("hide");
  setupView.classList.remove("hide");
});

// ---------- Init ----------
(async function init(){
  await checkBackend();
  await loadWhisperModels();
  await loadOllamaModels();

  // Default selection rule:
  // iPhone -> whisper
  // Android/desktop -> webspeech if supported, else whisper
  if(isIOS()){
    sttEngine.value = "whisper";
  } else {
    sttEngine.value = getSpeechRec() ? "webspeech" : "whisper";
  }

  refreshEngineUI();

  sttEngine.addEventListener("change", () => {
    stopAllSTT();
    refreshEngineUI();
  });

  setSTT("STT: idle", true);
  statusLine.textContent = "Ready.";
  setButtonsRunning(false);
})();
