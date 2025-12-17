(() => {
  const setupView = document.getElementById("setupView");
  const liveView = document.getElementById("liveView");

  const backendUrlInput = document.getElementById("backendUrl");
  const resumeInput = document.getElementById("resume");
  const toneSelect = document.getElementById("tone");
  const setupStatus = document.getElementById("setupStatus");

  const btnStartInterview = document.getElementById("btnStartInterview");
  const btnTestOllama = document.getElementById("btnTestOllama");

  const liveTranscript = document.getElementById("liveTranscript");
  const liveAnswer = document.getElementById("liveAnswer");
  const liveStatus = document.getElementById("liveStatus");

  const btnStartSTT = document.getElementById("btnStartSTT");
  const btnStopSTT = document.getElementById("btnStopSTT");
  const btnGen = document.getElementById("btnGen");
  const btnClear = document.getElementById("btnClear");

  function baseUrl() {
    const v = (backendUrlInput.value || "").trim();
    return v ? v.replace(/\/+$/, "") : "";
  }

  function api(path) {
    return `${baseUrl()}${path}`;
  }

  function setSetupStatus(msg) { setupStatus.textContent = msg || ""; }
  function setLiveStatus(msg) { liveStatus.textContent = msg || ""; }

  // ---------------------------
  // Page switching
  // ---------------------------
  btnStartInterview.addEventListener("click", () => {
    setupView.classList.add("hidden");
    liveView.classList.remove("hidden");
    setLiveStatus("Ready. Click Start STT, then speak.");
  });

  // ---------------------------
  // Test Ollama from backend
  // ---------------------------
  btnTestOllama.addEventListener("click", async () => {
    setSetupStatus("Testing Ollama from backend...");
    try {
      const r = await fetch(api("/api/ollama/tags"));
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      setSetupStatus("Ollama OK. /api/tags reachable. " + t);
    } catch (e) {
      setSetupStatus("Ollama test failed: " + String(e.message || e));
    }
  });

  // ---------------------------
  // Simple STT (WebSpeech) so you can test transcript live
  // Replace this block with your existing STT if you already have it.
  // ---------------------------
  let rec = null;
  let fullText = "";

  function startSTT() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setLiveStatus("WebSpeech not supported in this browser. Use Chrome.");
      return;
    }

    fullText = "";
    liveTranscript.textContent = "";
    setLiveStatus("Listening...");

    rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const txt = event.results[i][0].transcript;
        if (event.results[i].isFinal) fullText += txt + " ";
        else interim += txt;
      }
      liveTranscript.textContent = (fullText + interim).trim();
    };

    rec.onerror = (e) => setLiveStatus("STT error: " + (e.error || "unknown"));
    rec.onend = () => setLiveStatus("STT stopped.");

    rec.start();
  }

  function stopSTT() {
    try { rec && rec.stop(); } catch {}
    rec = null;
  }

  btnStartSTT.addEventListener("click", startSTT);
  btnStopSTT.addEventListener("click", stopSTT);

  // ---------------------------
  // Generate Answer (calls your backend, backend calls Ollama through ngrok)
  // ---------------------------
  btnGen.addEventListener("click", async () => {
    const transcript = (liveTranscript.textContent || "").trim();
    const resume = (resumeInput.value || "").trim();
    const tone = (toneSelect.value || "medium").trim();

    if (!transcript) {
      liveAnswer.textContent = "Speak first so transcript has text.";
      return;
    }

    setLiveStatus("Generating answer...");
    liveAnswer.textContent = "Thinking...";

    try {
      const r = await fetch(api("/api/answer"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, resume, answer_tone: tone }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || JSON.stringify(data));

      liveAnswer.textContent = data.answer || "No answer returned.";
      setLiveStatus("Answer ready.");
    } catch (e) {
      liveAnswer.textContent = "Error: " + String(e.message || e);
      setLiveStatus("Answer failed.");
    }
  });

  btnClear.addEventListener("click", () => {
    liveTranscript.textContent = "";
    liveAnswer.textContent = "";
    fullText = "";
    setLiveStatus("Cleared.");
  });
})();
