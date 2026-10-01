import { readSoundPack, type SoundPack } from "./sound";

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
