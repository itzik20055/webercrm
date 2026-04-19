import sharp from "sharp";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { join } from "path";

const ICONS_DIR = join(process.cwd(), "public", "icons");

const jobs: Array<{ src: string; out: string; size: number }> = [
  { src: "icon-512.svg", out: "apple-touch-icon.png", size: 180 },
  { src: "icon-512.svg", out: "icon-192.png", size: 192 },
  { src: "icon-512.svg", out: "icon-512.png", size: 512 },
  { src: "icon-maskable.svg", out: "icon-maskable-192.png", size: 192 },
  { src: "icon-maskable.svg", out: "icon-maskable-512.png", size: 512 },
];

const stale = [
  "icon-512-180.png",
  "icon-512-192.png",
  "icon-512-512.png",
  "icon-maskable-192.png",
  "icon-maskable-512.png",
];

async function main() {
  for (const name of stale) {
    const p = join(ICONS_DIR, name);
    if (existsSync(p)) {
      try { unlinkSync(p); } catch {}
    }
  }

  for (const { src, out, size } of jobs) {
    const svgBuffer = readFileSync(join(ICONS_DIR, src));
    const png = await sharp(svgBuffer, { density: 384 })
      .resize(size, size)
      .png({ quality: 100, compressionLevel: 9 })
      .toBuffer();
    writeFileSync(join(ICONS_DIR, out), png);
    console.log(`✓ ${out} (${size}x${size}, ${png.byteLength} bytes)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
