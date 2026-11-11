/**
 * Tiny async event queue. Lets callback-driven components (search executor)
 * surface live progress events through the orchestrator's async generator
 * without inverting control.
 */
import type { AgentStreamEvent } from "@/shared/types/events";

export class EventQueue {
  private items: AgentStreamEvent[] = [];
  private waiters: Array<() => void> = [];
  private closed = false;

  push(event: AgentStreamEvent): void {
    this.items.push(event);
    const ready = this.waiters.splice(0);
    for (const resolve of ready) resolve();
  }

  close(): void {
    this.closed = true;
    const ready = this.waiters.splice(0);
    for (const resolve of ready) resolve();
  }

  /** Yields events until the queue is closed AND drained. */
  async *drain(): AsyncGenerator<AgentStreamEvent> {
    while (true) {
      while (this.items.length > 0) {
        const event = this.items.shift();
        if (event !== undefined) yield event;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}
