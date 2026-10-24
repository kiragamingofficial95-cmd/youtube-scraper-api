import { Innertube } from 'youtubei.js';

// youtubei.js references a global `Text` class that is missing in Node.
import { Text } from '../node_modules/youtubei.js/dist/src/parser/misc.js';
globalThis.Text = Text;

let clientPromise = null;
export function getInnertube() {
  if (!clientPromise) {
    clientPromise = Innertube.create().catch((e) => { clientPromise = null; throw e; });
  }
  return clientPromise;
}

export async function yt() {
  return getInnertube();
}