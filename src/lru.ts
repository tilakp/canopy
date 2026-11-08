// A bounded cache that drops the least recently used entry when full. The
// caches it replaced were cleared all at once at their limit, so the next
// render recomputed everything.
export class LruCache<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly limit: number) {}

  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      // A Map iterates in insertion order: re-inserting marks it as newest.
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value as K);
  }

  get size(): number {
    return this.entries.size;
  }
}
