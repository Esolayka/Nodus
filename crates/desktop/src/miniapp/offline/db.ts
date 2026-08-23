// A hand-rolled, minimal IndexedDB wrapper — this app only ever needs
// get/put/delete/getAll on a couple of flat object stores, nowhere near
// enough to justify a dependency for it.

const DB_NAME = "nodus-miniapp";
const DB_VERSION = 1;

export const STORE_NOTES = "notes";
export const STORE_QUEUE = "queue";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NOTES)) {
        db.createObjectStore(STORE_NOTES, { keyPath: "path" });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function withStore<T>(storeName: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function dbGet<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  return withStore<T>(storeName, "readonly", (store) => store.get(key) as IDBRequest<T>);
}

export function dbGetAll<T>(storeName: string): Promise<T[]> {
  return withStore<T[]>(storeName, "readonly", (store) => store.getAll() as IDBRequest<T[]>);
}

export function dbPut(storeName: string, value: unknown): Promise<IDBValidKey> {
  return withStore(storeName, "readwrite", (store) => store.put(value));
}

export function dbDelete(storeName: string, key: IDBValidKey): Promise<undefined> {
  return withStore(storeName, "readwrite", (store) => store.delete(key));
}
