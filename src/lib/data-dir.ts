import fs from "node:fs";
import path from "node:path";

// Локалд ./data хавтас. Vercel дээр файлын систем зөвхөн /tmp-д бичигддэг
// (түр зуурын — instance дахин асахад өгөгдөл анхны төлөвтөө орно).
export function dbUrl(file: string): string {
  if (process.env.VERCEL) return `file:/tmp/${file}`;
  fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
  return `file:./data/${file}`;
}
