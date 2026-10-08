import base from "./playwright.config";
export default {
  ...base,
  webServer: {
    command: "npx serve dist -l 4199 --no-clipboard",
    port: 4199,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  use: { ...base.use, baseURL: "http://127.0.0.1:4199" },
};
