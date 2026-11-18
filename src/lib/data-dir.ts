import fs from "node:fs";
import path from "node:path";

// Локалд ./data хавтас. Vercel дээр файлын систем зөвхөн /tmp-д бичигддэг
// (түр зуурын — instance дахин асахад өгөгдөл анхны төлөвтөө орно).
export function dbUrl(file: string): string {
  if (process.env.VERCEL) return `file:/tmp/${file}`;
  // DATA_DIR-ээр өөр хавтас зааж болно (eval нь жинхэнэ өгөгдлийг хөндөхгүйн тулд тусдаа хавтас ашигладаг).
  const dir = process.env.DATA_DIR || "data";
  fs.mkdirSync(path.join(/*turbopackIgnore: true*/ process.cwd(), dir), { recursive: true });
  return `file:./${dir}/${file}`;
}
