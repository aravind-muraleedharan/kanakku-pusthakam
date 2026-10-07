// Cached master data (accounts, categories, payment modes).
import { api } from "./api.js";

let cache = null;

export async function masters(force = false) {
  if (!cache || force) cache = await api.masters();
  return cache;
}

export function invalidateMasters() {
  cache = null;
}

export const active = (list) => list.filter((x) => x.active);
