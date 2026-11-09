const config = require("../electron/config.json");

if (typeof config.backendUrl !== "string" || !config.backendUrl.trim()) {
  console.error("Set electron/config.json backendUrl to the deployed HTTPS API before building a release.");
  process.exitCode = 1;
} else {
  const backendUrl = new URL(config.backendUrl);
  if (backendUrl.protocol !== "https:") {
    console.error("Release backendUrl must use HTTPS.");
    process.exitCode = 1;
  }
}
