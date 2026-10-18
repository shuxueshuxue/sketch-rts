// The repo's own static pages as a browser opens them from the commit's dev server, at every --sizes viewport: today the
// unit sheet. A page that logs an error, answers a request with an error or leaves an image unloaded fails the scene.
// Rewritten from Art Lane's pageshot.mjs. A page under docs/ that shows images cannot be added: a commit's copy takes
// docs/ text only.
import type { Scene } from "../drivers/browser";

const PAGES = [["unit-sheet", "/unit-sheet.html", "#sheet *"]] as const;

export default async function (s: Scene) {
  const base = new URL(s.page.url()).origin, problems: string[] = [];
  s.page.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") problems.push(`console: ${message.text()}`); });
  s.page.on("requestfailed", (request: { url(): string }) => problems.push(`failed: ${request.url()}`));
  s.page.on("response", (response: { url(): string; status(): number }) => { if (response.status() >= 400) problems.push(`${response.status()}: ${response.url()}`); });
  for (const [name, path, content] of PAGES) {
    await s.page.goto(`${base}${path}`, { waitUntil: "networkidle" });
    await s.page.waitForSelector(content, { timeout: 60_000 });
    await s.wait(800);
    const broken = await s.page.evaluate(`[...document.images].filter(function (i) { return !i.complete || i.naturalWidth === 0; }).map(function (i) { return i.src; })`) as string[];
    problems.push(...broken.map((src) => `${name}: image not loaded: ${src}`));
    await s.shot(name);
  }
  s.must(problems.length === 0, `the pages logged errors or did not load:\n${problems.join("\n")}`);
}
