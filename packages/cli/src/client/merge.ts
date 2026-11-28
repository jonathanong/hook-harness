type Settled<T> = { index: number; result: IteratorResult<T> } | { index: number; error: unknown };

/**
 * Interleaves several polls as their results arrive. A poll is resumed only after the consumer
 * has handled its last result, so its `delay()` sees the consumer's latest state. With `once`,
 * each poll gives only its first result.
 */
export async function* merge<T>(polls: AsyncGenerator<T>[], once = false): AsyncGenerator<T> {
  const pending = new Map<number, Promise<Settled<T>>>();
  const pull = (index: number): void => {
    pending.set(
      index,
      polls[index]!.next().then(
        (result) => ({ index, result }),
        (error: unknown) => ({ index, error }),
      ),
    );
  };
  polls.forEach((_, index) => pull(index));
  while (pending.size > 0) {
    const settled = await Promise.race(pending.values());
    pending.delete(settled.index);
    if ("error" in settled) throw settled.error;
    if (settled.result.done) continue;
    yield settled.result.value;
    if (!once) pull(settled.index);
  }
}
