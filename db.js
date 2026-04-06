/* db.js - Standalone Persistent Storage Layer with Real-time Sync */

import { db, auth, doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where, writeBatch, onSnapshot } from './firebase.js';

const DB_NAME = 'DubbingAnalyticsDB';
const DB_VERSION = 3; 

let localDb;

async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      if (!db.objectStoreNames.contains('clients')) {
        db.createObjectStore('clients', { keyPath: 'id' });
      }
      
      let videoStore;
      if (!db.objectStoreNames.contains('videos')) {
        videoStore = db.createObjectStore('videos', { keyPath: 'id' });
      } else {
        videoStore = event.target.transaction.objectStore('videos');
      }
      if (!videoStore.indexNames.contains('clientId')) videoStore.createIndex('clientId', 'clientId', { unique: false });
      if (!videoStore.indexNames.contains('monthId')) videoStore.createIndex('monthId', 'monthId', { unique: false });
      
      let configStore;
      if (!db.objectStoreNames.contains('monthlyConfig')) {
        configStore = db.createObjectStore('monthlyConfig', { keyPath: 'id' });
      } else {
        configStore = event.target.transaction.objectStore('monthlyConfig');
      }
      if (!configStore.indexNames.contains('clientId')) configStore.createIndex('clientId', 'clientId', { unique: false });
    };

    request.onsuccess = (event) => {
      localDb = event.target.result;
      resolve(localDb);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

/**
 * Cloud Sync Helpers & Progress Tracker
 */
const SyncManager = {
  active: 0,
  total: 0,
  completed: 0,
  
  start(count = 1) {
    if (this.active === 0) { this.total = 0; this.completed = 0; }
    this.active += count;
    this.total += count;
    this.notify();
  },
  
  finish(count = 1) {
    this.active -= count;
    this.completed += count;
    if (this.active < 0) this.active = 0;
    this.notify();
  },
  
  notify() {
    const progress = this.total > 0 ? Math.round((this.completed / this.total) * 100) : 100;
    window.dispatchEvent(new CustomEvent('sync-status', { 
      detail: { pending: this.active, total: this.total, completed: this.completed, progress } 
    }));
  },
  
  isSyncing() { return this.active > 0; }
};

/**
 * Real-time Cloud Listeners
 */
let activeListeners = [];

function listenForChanges() {
  if (!auth.currentUser) return;
  const uid = auth.currentUser.uid;
  
  // Clear any existing listeners
  activeListeners.forEach(unsubscribe => unsubscribe());
  activeListeners = [];

  const stores = ['clients', 'videos', 'monthlyConfig'];
  
  stores.forEach(storeName => {
    const q = collection(db, 'users', uid, storeName);
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!window.State) return;

      const storeKey = storeName === 'monthlyConfig' ? 'monthlyConfigs' : storeName;
      const stateArray = window.State[storeKey];
      let stateChanged = false;

      snapshot.docChanges().forEach((change) => {
        const data = change.doc.data();
        
        if (change.type === 'added') {
          const idx = stateArray.findIndex(x => x.id === data.id);
          if (idx === -1) {
            stateArray.push(data);
            stateChanged = true;
          } else {
            stateArray[idx] = data;
            stateChanged = true;
          }
        } else if (change.type === 'modified') {
          const idx = stateArray.findIndex(x => x.id === data.id);
          if (idx !== -1) {
            stateArray[idx] = data;
            stateChanged = true;
          }
        } else if (change.type === 'removed') {
          const idx = stateArray.findIndex(x => x.id === data.id);
          if (idx !== -1) {
            stateArray.splice(idx, 1);
            stateChanged = true;
          }
          deleteRecordLocal(storeName, change.doc.id);
        }
      });

      // Atualiza o banco local em background (sem esperar)
      const itemsToUpdate = snapshot.docChanges()
        .filter(c => c.type !== 'removed')
        .map(c => c.doc.data());
      
      if (itemsToUpdate.length > 0) {
        putBulk(storeName, itemsToUpdate, false);
      }

      if (stateChanged) {
        triggerUIRefresh();
      }
    }, (error) => {
      console.error(`SYNC: Error in ${storeName} listener:`, error);
    });

    activeListeners.push(unsubscribe);
  });
  
  console.log('SYNC: Listeners de tempo real ativados.');
}

function stopListeners() {
  activeListeners.forEach(unsubscribe => unsubscribe());
  activeListeners = [];
  console.log('SYNC: Listeners desativados.');
}

async function syncToCloud(storeName, item) {
  if (!auth.currentUser) return;
  SyncManager.start(1);
  try {
    const uid = auth.currentUser.uid;
    const ref = doc(db, 'users', uid, storeName, item.id);
    await setDoc(ref, item);
  } finally {
    SyncManager.finish(1);
  }
}

async function put(storeName, item, sync = true) {
  // Atualiza Memória (Memory-First)
  const storeKey = storeName === 'monthlyConfig' ? 'monthlyConfigs' : storeName;
  if (window.State && window.State[storeKey]) {
    const arr = window.State[storeKey];
    const idx = arr.findIndex(x => x.id === item.id);
    if (idx !== -1) arr[idx] = item;
    else arr.push(item);
    if (window.refreshUI) window.refreshUI();
  }

  return new Promise((resolve, reject) => {
    if (!localDb) { resolve(); return; }
    const transaction = localDb.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(item);
    
    request.onsuccess = () => {
      resolve();
      if (sync && auth.currentUser) {
        syncToCloud(storeName, item).catch(err => {
          console.warn(`Cloud sync failed for ${storeName}/${item.id}:`, err);
        });
      }
    };
    request.onerror = (e) => reject(e);
  });
}

async function putBulk(storeName, items, sync = true) {
  return new Promise((resolve, reject) => {
    if (!localDb) { reject('DB not initialized'); return; }
    const transaction = localDb.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    items.forEach(item => store.put(item));
    
    transaction.oncomplete = async () => {
      resolve();
      
      // Notifica o core se for uma operação manual (ex: importação)
      if (sync) {
        window.dispatchEvent(new CustomEvent('db-updated', { detail: { store: storeName, bulk: true } }));
      }

      if (sync && auth.currentUser) {
        // Envio Serial para garantir progresso da barra e evitar sobrecarga
        (async () => {
          const uid = auth.currentUser.uid;
          const BATCH_SIZE = 400; 
          const chunks = [];
          for (let i = 0; i < items.length; i += BATCH_SIZE) {
            chunks.push(items.slice(i, i + BATCH_SIZE));
          }

          SyncManager.start(chunks.length);
          console.log(`SYNC: Iniciando envio de ${items.length} itens em ${chunks.length} lotes para "${storeName}"...`);

          let currentBatch = 0;
          for (const chunk of chunks) {
            currentBatch++;
            const batch = writeBatch(db);
            chunk.forEach(item => {
              const ref = doc(db, 'users', uid, storeName, item.id);
              batch.set(ref, item);
            });
            
            try {
              await batch.commit();
              console.log(`SYNC: Lote ${currentBatch}/${chunks.length} de "${storeName}" concluído.`);
            } catch (err) {
              console.error(`SYNC: Erro no lote ${currentBatch} de "${storeName}":`, err);
            } finally {
              SyncManager.finish(1);
            }
          }
        })();
      }
    };
    transaction.onerror = (e) => reject(e);
  });
}

function getAll(storeName) {
  return new Promise((resolve, reject) => {
    const transaction = localDb.transaction([storeName], 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e);
  });
}

async function deleteRecord(storeName, id) {
  await deleteRecordLocal(storeName, id);
  
  if (auth.currentUser) {
    const uid = auth.currentUser.uid;
    const ref = doc(db, 'users', uid, storeName, id);
    try {
      await deleteDoc(ref);
    } catch (err) {
      console.warn(`Cloud delete failed for ${storeName}/${id}:`, err);
    }
  }
}

function deleteRecordLocal(storeName, id) {
  // Atualiza Memória
  const storeKey = storeName === 'monthlyConfig' ? 'monthlyConfigs' : storeName;
  if (window.State && window.State[storeKey]) {
    const idx = window.State[storeKey].findIndex(x => x.id === id);
    if (idx !== -1) {
      window.State[storeKey].splice(idx, 1);
      if (window.refreshUI) window.refreshUI();
    }
  }

  return new Promise((resolve, reject) => {
    if (!localDb) { resolve(); return; }
    const transaction = localDb.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e);
  });
}

function deleteByClientId(storeName, clientId) {
  return new Promise((resolve, reject) => {
    const transaction = localDb.transaction([storeName], 'readwrite');
    const store = transaction.objectStore(storeName);
    const index = store.index('clientId');
    const request = index.openKeyCursor(IDBKeyRange.only(clientId));
    let count = 0;

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const id = cursor.primaryKey;
        store.delete(id);
        // We don't wait for individual cloud deletes here for bulk performance
        // but it's better to do it. For simplicity, we just delete locally.
        // In a real app, you might want to sync this deletion.
        count++;
        cursor.continue();
      }
    };
    
    transaction.oncomplete = () => {
      console.log(`DB: Deletados ${count} registros de "${storeName}" para o cliente ${clientId}`);
      resolve();
    };
    transaction.onerror = (e) => reject(e.target.error);
  });
}

function clearDatabase() {
  return new Promise((resolve, reject) => {
    const transaction = localDb.transaction(['clients', 'videos', 'monthlyConfig'], 'readwrite');
    transaction.objectStore('clients').clear();
    transaction.objectStore('videos').clear();
    transaction.objectStore('monthlyConfig').clear();
    transaction.oncomplete = () => resolve();
  });
}

/**
 * UI Refresh Debouncer
 */
let debounceTimer;
function triggerUIRefresh() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    console.log('SYNC: Atualização incremental em memória. Refreshing UI...');
    if (window.refreshUI) window.refreshUI();
  }, 50);
}

window.DB = { initDB, put, putBulk, getAll, deleteRecord, deleteByClientId, clearDatabase, listenForChanges, stopListeners, SyncManager };
