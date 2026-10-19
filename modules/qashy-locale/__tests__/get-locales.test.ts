import { Platform } from "react-native";

import { getApplicationLocales, getSystemLocales } from "../index";

const mockModule = {
  getApplicationLocales: jest.fn(),
  getSystemLocales: jest.fn(),
};

jest.mock("../src/QashyLocaleModule", () => ({
  __esModule: true,
  default: {
    getApplicationLocales: () => mockModule.getApplicationLocales(),
    getSystemLocales: () => mockModule.getSystemLocales(),
  },
}));

const originalOS = Platform.OS;
function setOS(os: string): void {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true });
}

afterEach(() => {
  setOS(originalOS);
  mockModule.getApplicationLocales.mockReset();
  mockModule.getSystemLocales.mockReset();
});

describe("locale reads with the native module available", () => {
  it("returns what native reports", () => {
    setOS("android");
    mockModule.getApplicationLocales.mockReturnValue("fr-FR");
    mockModule.getSystemLocales.mockReturnValue("de-DE,en-US");
    expect(getApplicationLocales()).toBe("fr-FR");
    expect(getSystemLocales()).toEqual(["de-DE", "en-US"]);
  });

  it("lets a read error propagate instead of reading it as system", () => {
    setOS("android");
    mockModule.getApplicationLocales.mockImplementation(() => {
      throw new Error("native read failed");
    });
    mockModule.getSystemLocales.mockImplementation(() => {
      throw new Error("native read failed");
    });
    expect(() => getApplicationLocales()).toThrow("native read failed");
    expect(() => getSystemLocales()).toThrow("native read failed");
  });

  it("returns empty values on web without touching native", () => {
    setOS("web");
    expect(getApplicationLocales()).toBe("");
    expect(getSystemLocales()).toEqual([]);
    expect(mockModule.getApplicationLocales).not.toHaveBeenCalled();
  });
});
