const none: {
  getPlacedWidgets(): Promise<{ id: number; kind: string }[]>;
  update(json: string): Promise<void>;
  clear(): Promise<void>;
  reportHeadlessResult(ok: boolean): void;
  setBackgroundSync?(enabled: boolean): Promise<void>;
} | null = null;
export default none;
