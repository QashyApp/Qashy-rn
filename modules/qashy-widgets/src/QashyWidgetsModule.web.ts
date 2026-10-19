const none: {
  getPlacedWidgets(): Promise<{ id: number; kind: string }[]>;
  update(json: string): Promise<void>;
  clear(): Promise<void>;
  reportHeadlessResult(ok: boolean): void;
} | null = null;
export default none;
