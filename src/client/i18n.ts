export type Locale = "en" | "zh";

type TranslationValues = Record<string, number | string>;

const EN_TRANSLATIONS = {
  "common.back": "Back",
  "home.create.title": "Create Game",
  "home.profile.title": "Profile",
  "home.results.title": "Match Results",
  "home.roomSetup.title": "Room Setup",
  "home.rooms.label": "Rooms",
  "home.rooms.note": "Browse public rooms on this server.",
  "home.rooms.title": "Rooms",
  "home.signedIn": "Signed in as {name}.",
  "home.title": "Sketch RTS",
  "profile.open.label": "Profile",
  "profile.open.note": "Player id {id}...",
  "roomCreate.aiPlayers.label": "Computer players",
  "roomCreate.defaultName": "{name}'s Room",
  "roomCreate.humanPlayers.label": "Human players",
  "roomCreate.knownMapError": "Choose a known map.",
  "roomCreate.map.label": "Map",
  "roomCreate.name.label": "Room name",
  "roomCreate.private.label": "Private room",
  "roomCreate.slotCountFallback": "Choose slot counts",
  "roomCreate.slotCountLabel": "{count} total slots",
  "roomCreate.slotCountRangeError": "Rooms need 2-30 total slots and at least one human player.",
  "roomCreate.submit": "Create Room",
} as const;

export type TranslationKey = keyof typeof EN_TRANSLATIONS;

const ZH_TRANSLATIONS: Record<TranslationKey, string> = {
  "common.back": "返回",
  "home.create.title": "创建游戏",
  "home.profile.title": "个人资料",
  "home.results.title": "比赛结果",
  "home.roomSetup.title": "房间设置",
  "home.rooms.label": "房间",
  "home.rooms.note": "浏览此服务器上的公开房间。",
  "home.rooms.title": "房间",
  "home.signedIn": "已以 {name} 登录。",
  "home.title": "Sketch RTS",
  "profile.open.label": "个人资料",
  "profile.open.note": "玩家 ID {id}...",
  "roomCreate.aiPlayers.label": "电脑玩家",
  "roomCreate.defaultName": "{name}的房间",
  "roomCreate.humanPlayers.label": "人类玩家",
  "roomCreate.knownMapError": "请选择已知地图。",
  "roomCreate.map.label": "地图",
  "roomCreate.name.label": "房间名",
  "roomCreate.private.label": "私人房间",
  "roomCreate.slotCountFallback": "请选择槽位数量",
  "roomCreate.slotCountLabel": "共 {count} 个槽位",
  "roomCreate.slotCountRangeError": "房间需要 2-30 个总槽位，并且至少包含 1 名人类玩家。",
  "roomCreate.submit": "创建房间",
};

const TRANSLATIONS: Record<Locale, Record<TranslationKey, string>> = {
  en: EN_TRANSLATIONS,
  zh: ZH_TRANSLATIONS,
};

export function detectLocale(languages: readonly string[] = []): Locale {
  return languages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh" : "en";
}

export function browserLanguages(source: Pick<Navigator, "language" | "languages"> = navigator): string[] {
  if (source.languages.length > 0) return [...source.languages];
  return source.language ? [source.language] : [];
}

export function createBrowserI18n(source?: Pick<Navigator, "language" | "languages">) {
  const locale = detectLocale(source ? browserLanguages(source) : browserLanguages());
  return createI18n(locale);
}

export function createI18n(locale: Locale) {
  const dictionary = TRANSLATIONS[locale];
  return {
    locale,
    t(key: TranslationKey, values: TranslationValues = {}) {
      const template = dictionary[key];
      if (template === undefined) {
        throw new Error(`Missing ${locale} translation for ${key}`);
      }
      return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, name: string) => {
        if (!(name in values)) {
          throw new Error(`Missing value ${name} for ${key}`);
        }
        return String(values[name]);
      });
    },
  };
}
