import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";
import { applyTheme, readStoredTheme } from "./theme";

// Apply the last chosen theme before the first paint, then the account setting
// (if any) replaces it once /auth/me returns.
applyTheme(readStoredTheme());
createApp(App).mount("#app");
