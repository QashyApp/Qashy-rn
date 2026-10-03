import type { SystemPalettes } from "./QashyDynamicColorsModule";

const none: {
  isAvailable(): boolean;
  getPalettes(): SystemPalettes | null;
} | null = null;
export default none;
