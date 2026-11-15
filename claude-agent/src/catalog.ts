import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { config } from "./config.ts";

export type Collection = {
  code: string;
  name: string;
  folder: string;
  /** SKU codes found in the folder, e.g. PJ-1262, WSP-1262. */
  skus: string[];
  images: string[];
};

export type Catalog = {
  clientDir: string;
  brandGuidePdf: string | null;
  logos: string[];
  collections: Collection[];
  /** Folders that aren't a collection (lifestyle shoots, launch graphics). */
  photoFolders: { folder: string; images: string[]; skusPictured: string[] }[];
};

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const COLLECTION_FOLDER = /^(\d{2,5})\s*-\s*(.+?)\s*$/;
const SKU = /\b([A-Z]{1,5})-(\d{3,5})(?:-([A-Z0-9]{1,3}))?/g;

function listFiles(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => !f.startsWith(".")) : [];
}

function skusIn(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) for (const m of n.matchAll(SKU)) out.add(m[3] && /^[A-Z]$/.test(m[3]) ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`);
  return [...out].sort();
}

/** Build the product catalog from the client's folder structure. Names come only from folder names, never invented. */
export function buildCatalog(clientDir = config.clientDir): Catalog {
  const resources = path.join(clientDir, config.resourcesDir);
  const assets = path.join(clientDir, config.assetsDir);
  const resFiles = listFiles(resources);
  const pdfs = resFiles.filter((f) => /\.pdf$/i.test(f));
  const brandGuide = pdfs.find((f) => /brand|style/i.test(f)) ?? null;

  const collections: Collection[] = [];
  const photoFolders: Catalog["photoFolders"] = [];
  for (const folder of listFiles(assets)) {
    const full = path.join(assets, folder);
    if (!fs.statSync(full).isDirectory()) continue;
    const images = listFiles(full).filter((f) => IMAGE.test(f));
    const m = folder.match(COLLECTION_FOLDER);
    if (m) collections.push({ code: m[1], name: m[2], folder: full, skus: skusIn(images), images });
    else photoFolders.push({ folder: full, images, skusPictured: skusIn(images) });
  }
  collections.sort((a, b) => a.name.localeCompare(b.name));

  return {
    clientDir,
    brandGuidePdf: brandGuide ? path.join(resources, brandGuide) : null,
    logos: resFiles.filter((f) => IMAGE.test(f) && /logo/i.test(f)).map((f) => path.join(resources, f)),
    collections,
    photoFolders,
  };
}

export function allSkus(c: Catalog): Set<string> {
  return new Set([...c.collections.flatMap((x) => x.skus), ...c.photoFolders.flatMap((x) => x.skusPictured)]);
}

/** Extract the brand guide to text once per run (pdftotext if installed). Returns the path agents should read. */
export function extractBrandGuide(c: Catalog, outDir: string): string | null {
  if (!c.brandGuidePdf) return null;
  const out = path.join(outDir, "brand-guide.txt");
  try {
    execFileSync("pdftotext", ["-layout", c.brandGuidePdf, out], { stdio: "ignore" });
    const text = fs.readFileSync(out, "utf8").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
    fs.writeFileSync(out, text);
    return out;
  } catch {
    return c.brandGuidePdf; // agents can Read the PDF directly
  }
}

/** Compact, model-friendly view of the catalog. */
export function catalogSummary(c: Catalog, skuTypes: Record<string, string> = {}): string {
  const lines = ["COLLECTIONS (use these names exactly):"];
  for (const col of c.collections) {
    const skus = col.skus.map((s) => (skuTypes[s.split("-")[0]] ? `${s} (${skuTypes[s.split("-")[0]]})` : s));
    lines.push(`- "${col.name}" (#${col.code}) · folder: ${col.folder}`, `  SKUs: ${skus.join(", ") || "none found"}`);
  }
  if (c.photoFolders.length) {
    lines.push("", "PHOTO / GRAPHICS FOLDERS:");
    for (const p of c.photoFolders) lines.push(`- ${p.folder} (${p.images.length} images; SKUs pictured: ${p.skusPictured.join(", ") || "n/a"})`);
  }
  const prefixes = [...new Set([...allSkus(c)].map((s) => s.split("-")[0]))].sort();
  const unknown = prefixes.filter((p) => !skuTypes[p]);
  if (unknown.length) {
    lines.push("", `SKU prefixes with NO known product type: ${unknown.join(", ")}. Don't guess what they are; refer to the collection, or mark [NEED: product name for <SKU>].`);
  }
  return lines.join("\n");
}
