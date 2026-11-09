const isLaptopSized = window.matchMedia("(min-width: 960px)").matches;
const shell = document.getElementById("app-shell");
const unsupported = document.getElementById("unsupported");
const authScreen = document.getElementById("auth-screen");
const loadingScreen = document.getElementById("loading-screen");
if (window.zoeDesktop?.isDesktop) {
  document.querySelector(".assistant-launcher").hidden = true;
}
if (!isLaptopSized) {
  shell.hidden = true;
  authScreen.hidden = true;
  unsupported.hidden = false;
}

const toast = document.getElementById("toast");
let toastTimer;
let authMode = "signin";
let currentName = "there";

document.getElementById("auth-switch").addEventListener("click", () => {
  authMode = authMode === "signin" ? "signup" : "signin";
  const isSignUp = authMode === "signup";
  const nameInput = document.getElementById("auth-name");
  document.getElementById("name-label").textContent = isSignUp ? "Your name" : "Your name (optional)";
  nameInput.required = isSignUp;
  document.getElementById("auth-eyebrow").textContent = isSignUp ? "A SPACE OF YOUR OWN" : "WELCOME BACK";
  document.getElementById("auth-title").textContent = isSignUp ? "Let’s get started." : "Come on in.";
  document.getElementById("auth-subtitle").textContent = isSignUp
    ? "Create your demo space and meet Zoe."
    : "Sign in to pick up where you left off.";
  document.getElementById("auth-submit").innerHTML = isSignUp
    ? 'Create demo account <span>↗</span>'
    : 'Sign in <span>↗</span>';
  document.getElementById("auth-switch-copy").textContent = isSignUp
    ? "Already have an account?"
    : "New to Zoe?";
  document.getElementById("auth-switch").textContent = isSignUp
    ? "Sign in"
    : "Create an account";
});

function waitForLoadingBeat(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function updateLoadingStep(activeStep, progress, caption) {
  document.querySelectorAll(".loading-step").forEach((step, index) => {
    const state = step.querySelector(".step-state");
    step.classList.toggle("is-complete", index < activeStep);
    step.classList.toggle("is-active", index === activeStep);
    state.textContent = index < activeStep ? "Done" : index === activeStep ? "In progress" : "";
  });
  document.getElementById("loading-caption").textContent = caption;
  document.getElementById("loading-progress").setAttribute("aria-valuenow", progress);
  document.getElementById("loading-progress-fill").style.width = `${progress}%`;
  document.getElementById("loading-progress-value").textContent = `${progress}%`;
  document.getElementById("loading-progress-label").textContent = caption;
}

async function showStartupLoading() {
  updateLoadingStep(-1, 0, "Starting on this device");
  await waitForLoadingBeat(180);
  updateLoadingStep(0, 28, "Starting Zoe's interface");
  await waitForLoadingBeat(430);
  updateLoadingStep(1, 68, "Preparing sign in and sign up");
  await waitForLoadingBeat(430);
  updateLoadingStep(2, 100, "Almost ready");
  await waitForLoadingBeat(300);

  document.getElementById("loading-title").textContent = "Your welcome is ready.";
  document.getElementById("loading-caption").textContent = "Choose sign in or create your demo account.";
  document.getElementById("loading-progress-label").textContent = "Ready";
  document.querySelectorAll(".loading-step").forEach((step) => {
    step.classList.remove("is-active");
    step.classList.add("is-complete");
    step.querySelector(".step-state").textContent = "Done";
  });
  await waitForLoadingBeat(320);

  loadingScreen.classList.add("is-leaving");
  authScreen.hidden = false;
  authScreen.classList.add("auth-screen-entering");
  await waitForLoadingBeat(420);
  loadingScreen.hidden = true;
  loadingScreen.classList.remove("is-entering", "is-leaving");
  authScreen.classList.remove("auth-screen-entering");
}

document.getElementById("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const enteredName = document.getElementById("auth-name").value.trim();
  const emailName = document.getElementById("auth-email").value
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .trim();
  if (window.zoeDesktop?.isDesktop) {
    try {
      const result = await window.zoeDesktop.authenticate({
        mode: authMode,
        email: document.getElementById("auth-email").value,
        password: document.getElementById("auth-password").value,
        name: enteredName,
      });
      if (result.needsEmailConfirmation) {
        showToast("Check your email to confirm your new account, then sign in.");
        return;
      }
      currentName = result.user.name || emailName || "there";
      document.getElementById("signout-button").hidden = false;
    } catch (error) {
      showToast(error.message);
      return;
    }
  } else {
    currentName = (enteredName || emailName || "there").replace(/\s+/g, " ");
    sessionStorage.setItem("zoeDemoName", currentName);
    sessionStorage.setItem("zoeDemoSignedIn", "true");
  }
  sessionStorage.setItem("zoeDemoName", currentName);
  document.getElementById("auth-form").reset();
  document.getElementById("loading-title").textContent = `Making room for you, ${currentName.split(/\s+/)[0]}.`;
  document.getElementById("loading-eyebrow").textContent = authMode === "signup"
    ? "CREATING YOUR LOCAL DEMO SPACE"
    : "GETTING YOUR LOCAL DEMO READY";
  updateLoadingStep(-1, 0, "Starting on this device");
  loadingScreen.classList.remove("is-leaving");
  loadingScreen.hidden = false;
  window.requestAnimationFrame(() => {
    authScreen.classList.add("screen-exiting");
    loadingScreen.classList.add("is-entering");
  });

  await waitForLoadingBeat(320);
  document.getElementById("profile-name").textContent = currentName;
  document.getElementById("profile-avatar").textContent = currentName.charAt(0).toUpperCase();
  updateLoadingStep(0, 34, "Personalizing your welcome");

  await waitForLoadingBeat(520);
  updateClock();
  setPage("overview", false);
  updateLoadingStep(1, 72, "Preparing your local space");

  await waitForLoadingBeat(520);
  updateLoadingStep(2, 100, "Opening Zoe");
  await waitForLoadingBeat(360);
  document.getElementById("loading-title").textContent = "Your space is ready.";
  document.getElementById("loading-caption").textContent = "Welcome in. Everything is running locally.";
  document.getElementById("loading-progress-label").textContent = "Ready";
  document.querySelectorAll(".loading-step").forEach((step) => {
    step.classList.remove("is-active");
    step.classList.add("is-complete");
    step.querySelector(".step-state").textContent = "Done";
  });
  await waitForLoadingBeat(320);

  loadingScreen.classList.add("is-leaving");
  shell.hidden = false;
  shell.classList.add("app-entering");
  await waitForLoadingBeat(420);
  authScreen.hidden = true;
  loadingScreen.hidden = true;
  authScreen.classList.remove("screen-exiting");
  loadingScreen.classList.remove("is-entering", "is-leaving");
  shell.classList.remove("app-entering");
});

function updateClock() {
  const now = new Date();
  document.getElementById("clock").textContent = new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
  document.getElementById("date-label").textContent = new Intl.DateTimeFormat([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now).toUpperCase();
}
updateClock();
setInterval(updateClock, 30_000);

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function setPage(page, announce = true) {
  const pageNames = {
    overview: "Overview",
    files: "Files",
    workspace: "Workspace",
    activity: "Activity",
  };
  if (!pageNames[page]) return;
  document.querySelectorAll("[data-page]").forEach((item) => {
    if (item.classList.contains("nav-item")) {
      item.classList.toggle("active", item.dataset.page === page);
    }
  });
  document.getElementById("page-title").textContent = pageNames[page];
  const subtitle = document.getElementById("welcome-subtitle");
  if (page === "overview") {
    subtitle.textContent = "A calmer way to move through your day.";
  } else {
    subtitle.textContent = `A little space for your ${pageNames[page].toLowerCase()}.`;
  }
  if (announce) showToast(`${pageNames[page]} opened inside Zoe.`);
}

document.querySelectorAll("[data-page]").forEach((button) => {
  button.addEventListener("click", () => setPage(button.dataset.page));
});

document.getElementById("help-button").addEventListener("click", () => {
  showToast("Zoe is a local demo. She only navigates these panels, and only after you approve.");
});

document.getElementById("signout-button").addEventListener("click", async () => {
  if (!window.zoeDesktop?.isDesktop) return;
  const button = document.getElementById("signout-button");
  button.disabled = true;
  try {
    await window.zoeDesktop.signOut();
    sessionStorage.clear();
    window.location.href = "/";
  } catch (error) {
    showToast(`Couldn't sign out cleanly. ${error.message}`);
  } finally {
    button.disabled = false;
  }
});

async function restoreDesktopSession() {
  document.querySelector(".demo-notice p").innerHTML =
    "<strong>Secure account sign-in.</strong> Zoe uses your account to access the hosted assistant. Your password is sent only to Zoe’s account service.";
  try {
    const user = await window.zoeDesktop.getSession();
    if (!user) {
      showStartupLoading();
      return;
    }
    currentName = user.name || user.email?.split("@")[0] || "there";
    sessionStorage.setItem("zoeDemoName", currentName);
    document.getElementById("profile-name").textContent = currentName;
    document.getElementById("profile-avatar").textContent = currentName.charAt(0).toUpperCase();
    document.getElementById("signout-button").hidden = false;
    authScreen.hidden = true;
    loadingScreen.hidden = true;
    shell.hidden = false;
    setPage(new URLSearchParams(window.location.search).get("page") || "overview", false);
  } catch (error) {
    showStartupLoading();
    showToast(`Couldn't restore your account session. ${error.message}`);
  }
}

if (window.zoeDesktop?.isDesktop) {
  restoreDesktopSession();
} else if (sessionStorage.getItem("zoeDemoSignedIn") === "true") {
  currentName = sessionStorage.getItem("zoeDemoName") || "there";
  document.getElementById("profile-name").textContent = currentName;
  document.getElementById("profile-avatar").textContent = currentName.charAt(0).toUpperCase();
  authScreen.hidden = true;
  loadingScreen.hidden = true;
  shell.hidden = false;
  setPage(new URLSearchParams(window.location.search).get("page") || "overview", false);
} else {
  showStartupLoading();
}
