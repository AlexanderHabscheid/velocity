export interface DeltaPatch {
  prefix: number;
  suffix: number;
  changed: string;
}

export function computeDelta(previous: string, next: string): DeltaPatch {
  let prefix = 0;
  const maxPrefix = Math.min(previous.length, next.length);
  while (prefix < maxPrefix && previous[prefix] === next[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  const maxSuffix = Math.min(previous.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return {
    prefix,
    suffix,
    changed: next.slice(prefix, next.length - suffix),
  };
}

export function applyDelta(previous: string, patch: DeltaPatch): string {
  const head = previous.slice(0, patch.prefix);
  const tail = patch.suffix > 0 ? previous.slice(previous.length - patch.suffix) : "";
  return `${head}${patch.changed}${tail}`;
}

export function shouldUseDelta(previous: string, next: string, patch: DeltaPatch): boolean {
  const deltaBytes = Buffer.byteLength(patch.changed, "utf8") + 8;
  const rawBytes = Buffer.byteLength(next, "utf8");
  return rawBytes > 0 && deltaBytes < rawBytes;
}
