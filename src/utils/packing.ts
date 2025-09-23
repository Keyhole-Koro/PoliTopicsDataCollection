import type { RawSpeechRecord } from "NationalDietAPI/Raw"; 

export interface OrderLen {
  idx: number;       // index in the dialogs array (0..N-1)
  speech_id: string; // dialog.speechID
  len: number;       // token length of dialog.speech
}

export interface IndexPack {
  indices: number[];    // indices into the original dialogs array
  speech_ids: string[]; // corresponding dialog.speechID values
  totalLen: number;     // total tokens for this pack
  oversized?: boolean;  // true if a single dialog exceeded the threshold
}

/** Function type for counting tokens */
export type CountFn = (text: string) => Promise<number>;

/** Concurrency-controlled mapper */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function run() {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await worker(items[i], i);
    }
  }

  const runners = Array.from({ length: Math.max(1, limit) }, run);
  await Promise.all(runners);
  return results;
}

/** Build OrderLen[] by counting tokens per speech using a CountFn. */
export async function buildOrderLenByTokens(options: {
  speeches: RawSpeechRecord[];
  countFn: CountFn;
  concurrency?: number;
}): Promise<OrderLen[]> {
  const counts = await mapWithConcurrency(
    options.speeches,
    options.concurrency ?? 8,
    (d) => options.countFn(d?.speech ?? "")
  );

  return options.speeches.map((d, idx) => ({
    idx,
    speech_id: d.speechID,
    len: counts[idx],
  }));
}

/** Greedy packer: group dialogs into packs with total tokens <= threshold. */
export function packIndexSets(
  orderLenList: OrderLen[],
  tokenThreshold: number
): IndexPack[] {
  if (!Number.isFinite(tokenThreshold) || tokenThreshold <= 0) {
    throw new Error(`tokenThreshold must be a positive number. Received: ${tokenThreshold}`);
  }

  const packs: IndexPack[] = [];
  let cur: IndexPack = { indices: [], speech_ids: [], totalLen: 0 };

  const pushCur = () => {
    if (cur.indices.length) packs.push(cur);
    cur = { indices: [], speech_ids: [], totalLen: 0 };
  };

  for (const item of orderLenList) {
    const { idx, speech_id, len } = item;

    if (len > tokenThreshold) {
      // single oversized speech -> its own pack
      pushCur();
      packs.push({ indices: [idx], speech_ids: [speech_id], totalLen: len, oversized: true });
      continue;
    }

    if (cur.totalLen + len > tokenThreshold && cur.indices.length > 0) {
      pushCur();
    }
    cur.indices.push(idx);
    cur.speech_ids.push(speech_id);
    cur.totalLen += len;
  }
  pushCur();
  return packs;
}

/** Convert IndexPack[] back to RawSpeechRecord[][]. */
export function materializeChunks(
  packs: IndexPack[],
  speeches: RawSpeechRecord[]
): RawSpeechRecord[][] {
  return packs.map((p) => p.indices.map((i) => speeches[i]));
}

/** End-to-end: count tokens -> greedy pack -> materialize chunks. */
export async function packSpeechesByTokenThreshold(options: {
  speeches: RawSpeechRecord[];
  tokenThreshold: number;
  countFn: CountFn;
  concurrency?: number;
}): Promise<{
  orderLens: OrderLen[];
  packs: IndexPack[];
  chunks: RawSpeechRecord[][];
}> {
  const orderLens = await buildOrderLenByTokens({
    speeches: options.speeches,
    countFn: options.countFn,
    concurrency: options.concurrency,
  });

  const packs = packIndexSets(orderLens, options.tokenThreshold);
  const chunks = materializeChunks(packs, options.speeches);
  return { orderLens, packs, chunks };
}
