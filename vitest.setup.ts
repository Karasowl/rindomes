// Node >= 22 trae un `localStorage` experimental propio que exige el flag
// --localstorage-file; bajo el entorno jsdom de vitest en esos Node (esta PC usa
// Node 26), `window.localStorage` termina undefined y cualquier test que lo toque
// muere en el setup. Instala una implementación en memoria estándar cuando falte,
// para que la suite corra igual en cualquier versión de Node.
function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
}

if (typeof window !== "undefined") {
  if (!window.localStorage) {
    Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  }
  if (!window.sessionStorage) {
    Object.defineProperty(window, "sessionStorage", { value: memoryStorage(), configurable: true });
  }
}
