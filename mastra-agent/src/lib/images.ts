import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Catalog } from "./catalog";

const SKU_FILE = /^[A-Z]{1,5}-\d/;
const IMAGE = /\.(png|jpe?g|webp)$/i;
const MAX_BYTES = 4_500_000;

export type PreparedImage = { collection: string; file: string; data: Buffer; mimeType: string };

/**
 * Pick one hero image per collection (the file named after the collection, not a SKU shot), collections named
 * in the idea first, and shrink each to ≤1568px JPEG so it fits the API's image limits.
 * The Agent SDK build lets the writer browse images itself; here code curates them up front.
 */
export function prepareHeroImages(catalog: Catalog, idea: string, outDir: string, max: number): PreparedImage[] {
  const wanted = [...catalog.collections].sort((a, b) => Number(idea.toLowerCase().includes(b.name.toLowerCase())) - Number(idea.toLowerCase().includes(a.name.toLowerCase())));
  const out: PreparedImage[] = [];
  fs.mkdirSync(path.join(outDir, "images"), { recursive: true });
  for (const col of wanted) {
    if (out.length >= max) break;
    const hero = col.images.find((f) => IMAGE.test(f) && !SKU_FILE.test(f)) ?? col.images.find((f) => IMAGE.test(f));
    if (!hero) continue;
    const src = path.join(col.folder, hero);
    const dest = path.join(outDir, "images", `${col.code}.jpg`);
    try {
      execFileSync("sips", ["-s", "format", "jpeg", "-Z", "1568", src, "--out", dest], { stdio: "ignore" });
    } catch {
      if (fs.statSync(src).size > MAX_BYTES || !/\.jpe?g$/i.test(src)) continue; // can't resize here; skip it
      fs.copyFileSync(src, dest);
    }
    const data = fs.readFileSync(dest);
    if (data.length <= MAX_BYTES) out.push({ collection: col.name, file: hero, data, mimeType: "image/jpeg" });
  }
  return out;
}
