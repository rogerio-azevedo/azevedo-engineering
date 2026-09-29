import { lstatSync, readdirSync, readlinkSync } from "node:fs";
import { join, relative, sep } from "node:path";

type FingerprintEntry = {
  path: string;
  type: "file" | "directory" | "symlink" | "other";
  mode: number;
  size: number;
  mtimeNs: string;
  link: string | null;
};

function portable(path: string): string {
  return path.split(sep).join("/");
}

function visit(root: string, directory: string, entries: FingerprintEntry[]): void {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return;
  }
  for (const name of names.sort()) {
    const absolute = join(directory, name);
    let stats;
    try {
      stats = lstatSync(absolute);
    } catch {
      continue;
    }
    const path = portable(relative(root, absolute));
    const base = { path, mode: stats.mode, size: stats.size, mtimeNs: String(stats.mtimeMs) };
    if (stats.isSymbolicLink()) {
      let link: string | null = null;
      try {
        link = readlinkSync(absolute);
      } catch {
        link = null;
      }
      entries.push({ ...base, type: "symlink", link });
      continue;
    }
    if (stats.isDirectory()) {
      entries.push({ ...base, type: "directory", link: null });
      visit(root, absolute, entries);
      continue;
    }
    entries.push({ ...base, type: stats.isFile() ? "file" : "other", link: null });
  }
}

export function captureTargetFingerprint(root: string): string {
  const entries: FingerprintEntry[] = [];
  visit(root, root, entries);
  return JSON.stringify(entries);
}
