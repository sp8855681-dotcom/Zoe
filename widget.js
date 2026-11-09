document.getElementById("open-assistant").addEventListener("click", async () => {
  try {
    await window.zoeDesktop.openAssistant();
  } catch (error) {
    console.error("Could not open Zoe chat:", error);
  }
});
