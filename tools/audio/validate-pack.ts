#!/usr/bin/env -S node --import tsx
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isRecord, readSoundPack } from "../../src/client/sound";

/** Use the runtime reader against the complete staged pack before uploading. */
export function validatePack(directory: string) {
  const id = basename(resolve(directory));
  const json = (file: string): unknown => {
    try { return JSON.parse(readFileSync(join(directory, file), "utf8")); }
    catch (cause) { throw new Error(`Sound pack ${id}: could not read ${file}`, { cause }); }
  };
  let manifest = json("pack.json");
  if (existsSync(join(directory, "extras.json"))) {
    const extras = json("extras.json");
    if (!isRecord(manifest) || !isRecord(manifest.sounds)) throw new Error(`Sound pack ${id}: pack.json needs a name and sounds`);
    if (!isRecord(extras) || !isRecord(extras.sounds)) throw new Error(`Sound pack ${id}: extras.json.sounds must map events to sounds`);
    manifest = { ...manifest, sounds: { ...manifest.sounds, ...extras.sounds } };
  }
  const urls = Object.fromEntries(readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(ogg|mp3|wav)$/i.test(entry.name))
    .map(entry => [entry.name, join(directory, entry.name)]));
  return readSoundPack(id, manifest, urls);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: node --import tsx tools/audio/validate-pack.ts <complete-pack-directory>");
    const pack = validatePack(process.argv[2]!);
    console.log(`Validated sound pack ${pack.id}: ${Object.keys(pack.sounds).length} events`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
