// =====================================================================
// events.ts — Typed Gameplay Event Emitter
// =====================================================================

import type { GameplayEventMap } from './types';

export type EventListener<T> = (payload: T) => void;

export class GameplayEventEmitter {
  private listeners: { [K in keyof GameplayEventMap]?: Array<EventListener<GameplayEventMap[K]>> } = {};

  on<K extends keyof GameplayEventMap>(event: K, listener: EventListener<GameplayEventMap[K]>): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]!.push(listener);
    return () => this.off(event, listener);
  }

  off<K extends keyof GameplayEventMap>(event: K, listener: EventListener<GameplayEventMap[K]>): void {
    const arr = this.listeners[event];
    if (!arr) return;
    const idx = arr.indexOf(listener);
    if (idx !== -1) arr.splice(idx, 1);
  }

  emit<K extends keyof GameplayEventMap>(event: K, payload: GameplayEventMap[K]): void {
    const arr = this.listeners[event];
    if (!arr) return;
    const snapshot = [...arr];
    for (const listener of snapshot) {
      listener(payload);
    }
  }

  clear(): void {
    this.listeners = {};
  }
}
