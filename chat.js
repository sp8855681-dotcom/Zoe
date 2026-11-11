const chatPage = document.getElementById("chat-page");
const chatMessages = document.getElementById("chat-messages");
const chatInput = document.getElementById("chat-input");
const modal = document.getElementById("permission-modal");
const toast = document.getElementById("toast");
const voiceToggle = document.getElementById("voice-toggle");
const voiceInputToggle = document.getElementById("voice-input-toggle");
const voiceInputStatus = document.getElementById("voice-input-status");
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const isDesktopApp = Boolean(window.zoeDesktop?.isDesktop);
let activeProposal = null;
let voiceEnabled = true;
let speechRecognition = null;
let isListening = false;
let toastTimer;

let currentName = sessionStorage.getItem("zoeDisplayName") || "there";
let greeting = `Hey ${currentName.split(/\s+/)[0]}, it’s Zoe. What would you like a hand with?`;
document.getElementById("welcome-message").textContent = greeting;
const webSessionReady = isDesktopApp
  ? Promise.resolve(true)
  : window.zoeWebAuth.getSession().then((user) => {
    if (!user) {
      window.location.replace("./");
      return false;
    }
    currentName = user.name || user.email?.split("@")[0] || "there";
    sessionStorage.setItem("zoeDisplayName", currentName);
    greeting = `Hey ${currentName.split(/\s+/)[0]}, it’s Zoe. What would you like a hand with?`;
    document.getElementById("welcome-message").textContent = greeting;
    return true;
  }).catch((error) => {
    voiceInputStatus.textContent = `Couldn't restore your account session: ${error.message}`;
    chatInput.disabled = true;
    return false;
  });

function setSpeaking(speaking) {
  chatPage.classList.toggle("is-speaking", speaking);
  document.getElementById("voice-status-text").textContent = speaking
    ? "ZOE IS SPEAKING"
    : "READY WHEN YOU ARE";
}

function speak(text) {
  if (!voiceEnabled || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
    setSpeaking(false);
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.onstart = () => setSpeaking(true);
  utterance.onend = () => setSpeaking(false);
  utterance.onerror = () => setSpeaking(false);
  window.speechSynthesis.speak(utterance);
}

function setListening(listening) {
  isListening = listening;
  chatPage.classList.toggle("is-listening", listening);
  voiceInputToggle.setAttribute("aria-pressed", String(listening));
  voiceInputToggle.setAttribute("aria-label", listening ? "Stop voice instruction" : "Start voice instruction");
  document.getElementById("voice-status-text").textContent = listening
    ? "LISTENING TO YOU"
    : "READY WHEN YOU ARE";
  if (!listening) voiceInputToggle.focus();
}

function startVoiceInput() {
  if (!SpeechRecognition) {
    voiceInputStatus.textContent = "Voice recognition isn’t available in this app.";
    return;
  }

  if (!speechRecognition) {
    speechRecognition = new SpeechRecognition();
    speechRecognition.lang = document.documentElement.lang || navigator.language;
    speechRecognition.continuous = false;
    speechRecognition.interimResults = false;
    speechRecognition.maxAlternatives = 1;
    speechRecognition.onstart = () => {
      setListening(true);
      voiceInputStatus.textContent = "Listening… tap the mic to stop";
    };
    speechRecognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .filter((result) => result.isFinal)
        .map((result) => result[0].transcript)
        .join(" ")
        .trim();
      if (!transcript) {
        voiceInputStatus.textContent = "I didn’t catch that. Tap the mic to try again.";
        return;
      }
      setListening(false);
      voiceInputStatus.textContent = "Zoe is responding to your voice request.";
      void sendMessage(transcript, { showUserMessage: false });
    };
    speechRecognition.onerror = (event) => {
      setListening(false);
      const messages = {
        "not-allowed": "Microphone access was denied. Allow it in your app settings to use voice input.",
        "service-not-allowed": "The browser speech service isn’t available.",
        network: "The browser speech service could not connect.",
        "no-speech": "I didn’t hear speech. Tap the mic and try again.",
        "audio-capture": "No microphone is available.",
      };
      voiceInputStatus.textContent = messages[event.error]
        || "Voice input failed. Please try again or type your request.";
    };
    speechRecognition.onend = () => {
      if (isListening) setListening(false);
    };
  }

  voiceInputStatus.textContent = "Requesting microphone access…";
  try {
    speechRecognition.start();
  } catch (error) {
    voiceInputStatus.textContent = `Couldn’t start voice input: ${error.message}`;
  }
}

function addMessage(text, kind) {
  const row = document.createElement("div");
  row.className = `message ${kind === "user" ? "user-message" : "assistant-message"}`;
  if (kind !== "user") {
    const avatar = document.createElement("span");
    avatar.className = "message-avatar";
    avatar.setAttribute("aria-label", "Zoe AI assistant");
    avatar.innerHTML = '<svg class="assistant-symbol" viewBox="0 0 48 40" aria-hidden="true"><path class="symbol-page" d="M24 15c-5-5-12-6-19-3v20c7-3 14-2 19 2m0-19c5-5 12-6 19-3v20c-7-3-14-2-19 2"/><path class="symbol-spine" d="M24 15v19"/><path class="symbol-lines" d="M9 18c5-1 9 0 12 2m-12 4c5-1 9 0 12 2m18-8c-5-1-9 0-12 2m12 2c-5-1-9 0-12 2"/><path class="symbol-spark" d="M36 3v8m-4-4h8"/></svg>';
    row.append(avatar);
  }
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.textContent = text;
  row.append(bubble);
  chatMessages.append(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  if (kind !== "user") speak(text);
}

async function postJson(endpoint, value) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Something went wrong.");
  return result;
}

function openPermission(proposal) {
  activeProposal = proposal;
  document.getElementById("proposal-title").textContent = proposal.title;
  document.getElementById("proposal-detail").textContent = proposal.description;
  modal.hidden = false;
  document.getElementById("approve-action").focus();
}

async function sendMessage(message, { showUserMessage = true } = {}) {
  if (!await webSessionReady) return;
  const cleaned = message.trim();
  if (!cleaned) return;
  if (cleaned.length > 1000) {
    voiceInputStatus.textContent = "That request was too long. Please try a shorter instruction.";
    return;
  }
  if (showUserMessage) addMessage(cleaned, "user");
  if (showUserMessage) chatInput.value = "";
  chatInput.disabled = true;
  document.querySelector(".conversation-card").classList.add("busy");
  try {
    const result = isDesktopApp
      ? await window.zoeDesktop.chat(cleaned)
      : await window.zoeWebAuth.chat(cleaned);
    addMessage(result.reply, "assistant");
    if (result.actionProposal === "minimize-previous-window") {
      await requestMinimizePreviousWindow();
    }
    if (result.proposal) openPermission(result.proposal);
  } catch (error) {
    addMessage(`I couldn't reach Zoe's online service. ${error.message}`, "assistant");
  } finally {
    chatInput.disabled = false;
    document.querySelector(".conversation-card").classList.remove("busy");
    if (showUserMessage) chatInput.focus();
  }
}

async function requestMinimizePreviousWindow() {
  if (!window.zoeDesktop?.isDesktop) {
    addMessage("App control is available only in the installed Zoe Windows app.", "assistant");
    return;
  }

  try {
    const outcome = await window.zoeDesktop.minimizePreviousWindow();
    addMessage(
      outcome.minimized ? `Done — minimized ${outcome.title}.` : "No problem. I left the app as it was.",
      "assistant",
    );
  } catch (error) {
    addMessage(`I couldn't minimize that app. ${error.message}`, "assistant");
  }
}

document.getElementById("chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(chatInput.value);
});
document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => sendMessage(button.dataset.prompt));
});

voiceToggle.addEventListener("click", () => {
  voiceEnabled = !voiceEnabled;
  voiceToggle.setAttribute("aria-pressed", String(voiceEnabled));
  voiceToggle.textContent = voiceEnabled ? "Replies on" : "Replies off";
  if (!voiceEnabled && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }
});

voiceInputToggle.addEventListener("click", () => {
  if (isListening) {
    speechRecognition.stop();
  } else {
    startVoiceInput();
  }
});

window.addEventListener("pagehide", () => {
  if (speechRecognition && isListening) speechRecognition.abort();
});

document.getElementById("approve-action").addEventListener("click", async () => {
  if (!activeProposal) return;
  const button = document.getElementById("approve-action");
  button.disabled = true;
  try {
    const result = await postJson("/api/approve", {
      proposalId: activeProposal.id,
      approved: true,
    });
    if (result.approved) {
      modal.hidden = true;
      window.location.href = `./?page=${encodeURIComponent(result.destination)}`;
    }
  } catch (error) {
    showToast(error.message);
    modal.hidden = true;
  } finally {
    activeProposal = null;
    button.disabled = false;
  }
});

function dismissPermission() {
  modal.hidden = true;
  activeProposal = null;
  addMessage("No problem. Nothing changed.", "assistant");
}

document.getElementById("decline-action").addEventListener("click", dismissPermission);
document.getElementById("modal-close").addEventListener("click", dismissPermission);
modal.addEventListener("click", (event) => {
  if (event.target === modal) dismissPermission();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modal.hidden) dismissPermission();
});

if (isDesktopApp) speak(greeting);

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}
