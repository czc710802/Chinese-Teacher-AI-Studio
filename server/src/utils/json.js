export function parseJson(value, fallback = []) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function safeJson(value) {
  return JSON.stringify(value ?? [], null, 2);
}
