const none: {
  getApplicationLocales(): string;
  setApplicationLocales(tags: string): Promise<void>;
  getSystemLocales(): string;
} | null = null;
export default none;
