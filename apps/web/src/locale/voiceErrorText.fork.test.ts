import { describe, expect, it } from "vite-plus/test";

import controller from "../../../../packages/client-runtime/src/voice-input/controller.ts?raw";
import pill from "../components/chat/VoiceInputErrorPill.tsx?raw";
import { englishVoiceError, VOICE_ERRORS_IN_CHINESE } from "./assembledText";
import catalog from "./zh-TW.json";

const translations: Record<string, string> = catalog;

describe("voice input errors in Chinese", () => {
  it("maps every translated controller error the pill labels back to English", () => {
    const labelled = [...pill.matchAll(/^\s+"([^"]+)": "[^"]+",$/gm)].map((match) => match[1]!);
    expect(labelled.length).toBeGreaterThan(10);
    const translatedAtSource = labelled.filter(
      (english) => english in translations && controller.includes(`"${english}"`),
    );
    expect(translatedAtSource.length).toBeGreaterThan(10);
    expect(translatedAtSource.map((english) => englishVoiceError(translations[english]!))).toEqual(
      translatedAtSource,
    );
  });

  it("matches the catalog's wording", () => {
    for (const [chinese, english] of Object.entries(VOICE_ERRORS_IN_CHINESE)) {
      expect(translations[english]).toBe(chinese);
    }
  });

  it("leaves other errors alone", () => {
    expect(englishVoiceError("The microphone disconnected.")).toBe("The microphone disconnected.");
    expect(englishVoiceError(null)).toBeNull();
  });
});
