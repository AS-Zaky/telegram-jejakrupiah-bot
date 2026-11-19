/** Jam:menit:detik.milidetik — biar kelihatan step mana yang menggantung. */
export const stamp = () => new Date().toISOString().slice(11, 23);

export const log = (tag, message) => console.log(`${stamp()} ${tag} ${message}`);

export function logError(tag, error) {
  console.error(`${stamp()} ${tag} ${error?.stack ?? error}`);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
