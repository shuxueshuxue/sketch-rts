// Stitches before/after screenshots side by side, each under its label, into one webp per pair (`sketch shot` runs it
// on the machine that took them), and measures how much of the picture changed: the share of pixels where a channel
// moved by more than 16 of 255. The browser's own canvas encodes the webp and reads the pixels, so no image library is
// needed. One argument: a JSON object { playwright, browsersPath?, pairs: [{ before, after, out, labels: [before, after] }] };
// one JSON line per pair on stdout, { out, diff }.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

type Pair = { before: string; after: string; out: string; labels: [string, string] };
const options = JSON.parse(process.argv[2]!) as { playwright: string; browsersPath?: string; pairs: Pair[] };
if (options.browsersPath) process.env.PLAYWRIGHT_BROWSERS_PATH = options.browsersPath;
const { chromium } = createRequire(import.meta.url)(options.playwright);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  for (const pair of options.pairs) {
    const sources = [pair.before, pair.after].map((file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`);
    const { webp, diff }: { webp: string; diff: number } = await page.evaluate(async ({ sources, labels }: { sources: string[]; labels: string[] }) => {
      const images = await Promise.all(sources.map((source) => new Promise<HTMLImageElement>((done, fail) => {
        const image = new Image(); image.onload = () => done(image); image.onerror = () => fail(new Error("unreadable png")); image.src = source;
      })));
      const gap = 12, band = 34, width = images.reduce((sum, image) => sum + image.width, 0) + gap, height = Math.max(...images.map((image) => image.height)) + band;
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height);
      ctx.font = "600 18px sans-serif"; ctx.fillStyle = "#222222"; ctx.textBaseline = "middle";
      let x = 0;
      images.forEach((image, index) => { ctx.fillText(labels[index]!, x + 10, band / 2); ctx.drawImage(image, x, band); x += image.width + gap; });
      // Both pictures on canvases of one size, so a picture of another size counts its missing part as changed.
      const w = Math.max(...images.map((image) => image.width)), h = Math.max(...images.map((image) => image.height));
      const pixels = images.map((image) => {
        const flat = document.createElement("canvas"); flat.width = w; flat.height = h;
        const c = flat.getContext("2d")!; c.drawImage(image, 0, 0);
        return c.getImageData(0, 0, w, h).data;
      });
      let changed = 0;
      for (let i = 0; i < pixels[0]!.length; i += 4) {
        if (Math.abs(pixels[0]![i]! - pixels[1]![i]!) > 16 || Math.abs(pixels[0]![i + 1]! - pixels[1]![i + 1]!) > 16 || Math.abs(pixels[0]![i + 2]! - pixels[1]![i + 2]!) > 16 || Math.abs(pixels[0]![i + 3]! - pixels[1]![i + 3]!) > 16) changed++;
      }
      return { webp: canvas.toDataURL("image/webp", 0.86), diff: changed / (w * h) };
    }, { sources, labels: pair.labels });
    if (!webp.startsWith("data:image/webp")) throw new Error("this browser encodes no webp");
    writeFileSync(pair.out, Buffer.from(webp.slice(webp.indexOf(",") + 1), "base64"));
    process.stdout.write(`${JSON.stringify({ out: pair.out, diff })}\n`);
  }
} finally {
  await browser.close();
}
