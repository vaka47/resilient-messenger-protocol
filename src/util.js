export function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === "object") {
    const output = {};

    for (const key of Object.keys(value).sort()) {
      output[key] = sortValue(value[key]);
    }

    return output;
  }

  return value;
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = rest[index + 1];

    if (!next || next.startsWith("--")) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    index += 1;
  }

  return { command, flags };
}

export function requireFlag(flags, name) {
  const value = flags[name];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required flag --${name}`);
  }

  return value;
}
