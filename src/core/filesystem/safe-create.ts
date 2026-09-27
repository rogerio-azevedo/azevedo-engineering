import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeSync,
  type Stats,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

type DirectoryIdentity = {
  path: string;
  realPath: string;
  dev: number;
  ino: number;
};

function isWithin(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && resolve(root, relativePath) === candidate;
}

function captureDirectory(root: string, directory: string): DirectoryIdentity {
  const stats = lstatSync(directory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`Unsafe parent directory: ${directory}`);
  const realPath = realpathSync(directory);
  if (!isWithin(root, realPath)) throw new Error(`Parent directory escapes the project root: ${directory}`);
  return { path: directory, realPath, dev: stats.dev, ino: stats.ino };
}

function assertSameDirectory(root: string, expected: DirectoryIdentity): void {
  const actual = captureDirectory(root, expected.path);
  if (actual.realPath !== expected.realPath || actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new Error(`Parent directory changed during exclusive file creation: ${expected.path}`);
  }
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function removeCreatedFileIfOwned(destination: string, opened: Stats | null): void {
  if (!opened) return;
  try {
    const current = lstatSync(destination);
    if (!current.isSymbolicLink() && current.isFile() && sameFile(current, opened)) unlinkSync(destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * Creates one file without following its final symlink and pins the parent
 * directory identity before, during, and after the write. Callers must create
 * and validate the parent chain first.
 */
export function createExclusiveVerifiedFile(projectRoot: string, destination: string, content: string): void {
  const root = realpathSync(projectRoot);
  const resolvedDestination = resolve(destination);
  const parent = captureDirectory(root, dirname(resolvedDestination));
  const anchoredDestination = join(parent.realPath, basename(resolvedDestination));
  if (!isWithin(root, anchoredDestination)) throw new Error(`File destination escapes the project root: ${destination}`);
  const flags = constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW;
  let descriptor: number | null = null;
  let opened: Stats | null = null;
  let complete = false;

  try {
    descriptor = openSync(anchoredDestination, flags, 0o666);
    opened = fstatSync(descriptor);
    if (!opened.isFile()) throw new Error(`Exclusive creation did not open a regular file: ${destination}`);

    const linked = lstatSync(anchoredDestination);
    if (linked.isSymbolicLink() || !sameFile(opened, linked)) {
      throw new Error(`File destination changed during exclusive creation: ${destination}`);
    }
    assertSameDirectory(root, parent);
    if (realpathSync(dirname(anchoredDestination)) !== parent.realPath) {
      throw new Error(`File parent changed during exclusive creation: ${destination}`);
    }

    const expected = Buffer.from(content, "utf8");
    let offset = 0;
    while (offset < expected.length) offset += writeSync(descriptor, expected, offset, expected.length - offset, offset);
    fsyncSync(descriptor);

    const actual = Buffer.alloc(expected.length);
    let readOffset = 0;
    while (readOffset < actual.length) {
      const bytes = readSync(descriptor, actual, readOffset, actual.length - readOffset, readOffset);
      if (bytes === 0) break;
      readOffset += bytes;
    }
    if (readOffset !== expected.length || !actual.equals(expected)) {
      throw new Error(`File verification failed after exclusive creation: ${destination}`);
    }

    assertSameDirectory(root, parent);
    const finalLinked = lstatSync(anchoredDestination);
    if (finalLinked.isSymbolicLink() || !sameFile(opened, finalLinked)) {
      throw new Error(`File destination changed after exclusive creation: ${destination}`);
    }
    complete = true;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (!complete) removeCreatedFileIfOwned(anchoredDestination, opened);
  }
}
