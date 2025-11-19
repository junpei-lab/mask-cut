import type { MaskingStatusEvent, MaskingStatusListener } from '../types/status.js';
import type { StatusFeedPort } from '../runtime/mcpServer.js';

export class InMemoryStatusStore implements StatusFeedPort {
  private readonly events: MaskingStatusEvent[] = [];

  private readonly listeners = new Set<MaskingStatusListener>();

  constructor(private readonly limit = 50) {}

  publish(event: MaskingStatusEvent): void {
    const enriched = { ...event };
    this.events.push(enriched);
    if (this.events.length > this.limit) {
      this.events.shift();
    }
    this.listeners.forEach((listener) => listener(enriched));
  }

  getSnapshot(): MaskingStatusEvent[] {
    return [...this.events];
  }

  onStatus(listener: MaskingStatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
