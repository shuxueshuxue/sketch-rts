// Stitches before/after screenshots side by side, each under its label, into one webp per pair (`sketch shot` runs it
// on the machine that took them). The browser's own canvas encodes the webp, so no image library is needed. One argument:
// a JSON object { playwright, browsersPath?, pairs: [{ before, after, out, labels: [before, after] }] }.
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
    const webp: string = await page.evaluate(async ({ sources, labels }: { sources: string[]; labels: string[] }) => {
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
      return canvas.toDataURL("image/webp", 0.86);
    }, { sources, labels: pair.labels });
    if (!webp.startsWith("data:image/webp")) throw new Error("this browser encodes no webp");
    writeFileSync(pair.out, Buffer.from(webp.slice(webp.indexOf(",") + 1), "base64"));
    process.stdout.write(`${JSON.stringify({ out: pair.out })}\n`);
  }
} finally {
  await browser.close();
}
