import { isRecord, readSoundPack, type SoundPack } from "./sound";

// @@@sound-packs - A sound pack is a folder audio-packs/<id>/ holding a pack.json (its name, and for each event the file
// it plays with its volume, pitch play and how many at once; see readSoundPack) and those files. The packs are found
// when the game is built or served, whichever folders are there, so a static build needs no list of them. The
// repository carries only the cc0 pack; a pack kept on one machine (audio-packs/ is ignored by git) is part of what is
// built there, and of nothing published from the repository. A pack that does not read is left out, saying why.
const manifests = import.meta.glob("/audio-packs/*/pack.json", { eager: true, import: "default" });
const files = import.meta.glob("/audio-packs/*/*.{ogg,mp3,wav}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

export const SOUND_PACKS: SoundPack[] = Object.entries(manifests).flatMap(([path, manifest]) => {
  const id = path.split("/")[2]!;
  const urls = Object.fromEntries(Object.entries(files).flatMap(([file, url]) => (file.startsWith(`/audio-packs/${id}/`) ? [[file.slice(`/audio-packs/${id}/`.length), url]] : [])));
  try {
    return [readSoundPack(id, manifest, urls)];
  } catch (error) {
    console.error(error);
    return [];
  }
});

// @@@served-sound-packs - A pack can also come from where the game is served, with no new build: audio-packs/served.json
// beside the page names packs whose folders sit next to it, and the one to play until the player chooses, as
// {"packs": ["<id>"], "default": "<id>"}. The repository's own file (public/) names none; a server lays its own folder
// over that path, kept out of the repository and of every release, to offer its packs, and takes one back by dropping it
// from the list. A listed pack that does not read is left out, saying why; no list that reads offers none.
export async function servedSoundPacks(base: string, load: typeof fetch = fetch): Promise<{ packs: SoundPack[]; fallback?: string }> {
  const json = async (path: string): Promise<unknown> => {
    const response = await load(`${base}audio-packs/${path}`);
    if (!response.ok) throw new Error(`Sound packs: ${path} answered ${response.status}`);
    return response.json();
  };
  let served: unknown;
  try {
    served = await json("served.json");
  } catch {
    return { packs: [] };
  }
  if (!isRecord(served) || !Array.isArray(served.packs)) return { packs: [] };
  const ids = served.packs.filter((id): id is string => typeof id === "string" && /^[\w-]+$/.test(id));
  const packs = await Promise.all(
    ids.map(async (id) => {
      try {
        const manifest = await json(`${id}/pack.json`);
        const urls = Object.fromEntries(namedFiles(manifest).map((file) => [file, `${base}audio-packs/${id}/${encodeURI(file)}`]));
        return [readSoundPack(id, manifest, urls)];
      } catch (error) {
        console.error(error);
        return [];
      }
    }),
  );
  return { packs: packs.flat(), ...(typeof served.default === "string" ? { fallback: served.default } : {}) };
}

// The files a pack.json names: each event's and each of its unit kinds' (readSoundPack checks the rest).
function namedFiles(manifest: unknown): string[] {
  const events = isRecord(manifest) && isRecord(manifest.sounds) ? Object.values(manifest.sounds).filter(isRecord) : [];
  return events
    .flatMap((entry) => [entry, ...(isRecord(entry.kinds) ? Object.values(entry.kinds).filter(isRecord) : [])])
    .flatMap((entry) => (typeof entry.file === "string" ? [entry.file] : []));
}
