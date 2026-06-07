import { describe, expect, it } from "vitest";
import { createI18n, detectLocale, type LabelKey, type TranslationKey } from "./i18n";

describe("client i18n", () => {
  it("selects Chinese for Chinese browser languages", () => {
    expect(detectLocale(["zh-CN", "en-US"])).toBe("zh");
    expect(detectLocale(["zh-Hant-TW"])).toBe("zh");
  });

  it("selects English for English or unknown browser languages", () => {
    expect(detectLocale(["en-US"])).toBe("en");
    expect(detectLocale(["fr-FR"])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });

  it("looks up translations and fails loudly for missing keys", () => {
    const en = createI18n("en");
    const zh = createI18n("zh");

    expect(en.t("home.rooms.label")).toBe("Rooms");
    expect(zh.t("home.rooms.label")).toBe("房间");
    expect(() => en.t("missing.key" as TranslationKey)).toThrow("Missing en translation for missing.key");
  });

  it("formats values and fails loudly when a value is missing", () => {
    const en = createI18n("en");

    expect(en.t("home.signedIn", { name: "Ada" })).toBe("Signed in as Ada.");
    expect(() => en.t("home.signedIn")).toThrow("Missing value name for home.signedIn");
  });

  it("looks up game object labels and fails loudly for missing labels", () => {
    const en = createI18n("en");
    const zh = createI18n("zh");

    expect(en.label("moonWell")).toBe("Moon Well");
    expect(zh.label("moonWell")).toBe("月井");
    expect(() => zh.label("missingKind" as LabelKey)).toThrow("Missing zh label for missingKind");
  });
});
