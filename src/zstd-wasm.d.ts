declare module "zstd-wasm" {
  export function init(): void | Promise<void>;
  export function compress(data: Uint8Array): Uint8Array | Promise<Uint8Array>;
  export function decompress(data: Uint8Array): Uint8Array | Promise<Uint8Array>;
}
