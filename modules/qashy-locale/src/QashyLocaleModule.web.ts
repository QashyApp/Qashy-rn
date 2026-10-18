const none: {
  getApplicationLocales(): string;
  setApplicationLocales(tags: string): Promise<void>;
  getSystemLocales(): string;
  getStrings(names: string[], localeTag: string): Promise<(string | null)[]>;
} | null = null;
export default none;
