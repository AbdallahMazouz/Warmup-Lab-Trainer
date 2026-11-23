import 'fake-indexeddb/auto';

const storage: Record<string, string> = {};
if (typeof Storage !== 'undefined') {
  Storage.prototype.getItem = function(k: string) { return storage[k] ?? null; };
  Storage.prototype.setItem = function(k: string, v: string) { storage[k] = String(v); };
  Storage.prototype.removeItem = function(k: string) { delete storage[k]; };
  Storage.prototype.clear = function() { Object.keys(storage).forEach(k => delete storage[k]); };
  Object.defineProperty(Storage.prototype, 'length', {
    get() { return Object.keys(storage).length; },
    configurable: true,
  });
  Storage.prototype.key = function(i: number) { return Object.keys(storage)[i] ?? null; };
}

const mockInstance = Object.create(Storage.prototype);
Object.defineProperty(globalThis, 'localStorage', {
  value: mockInstance,
  writable: true,
  configurable: true,
});

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    value: mockInstance,
    writable: true,
    configurable: true,
  });
}
