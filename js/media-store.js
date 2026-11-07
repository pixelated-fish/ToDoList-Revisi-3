/* ============================================================
   media-store.js — attachment blobs in IndexedDB

   LocalStorage holds roughly 5MB of text and would turn a 7MB
   video into ~9MB of base64, so attachments live here instead:
   the task record keeps a small { id, type, name, size } pointer
   and the bytes are stored as a Blob, with room for 50MB files.
   ============================================================ */

window.MyTasks = window.MyTasks || {};

(function (App) {
  'use strict';

  const DB_NAME = 'mytasks.media.v1';
  const STORE_NAME = 'media';
  const DB_VERSION = 1;

  let dbPromise = null;

  function isSupported() {
    try {
      return typeof window.indexedDB !== 'undefined' && window.indexedDB !== null;
    } catch (error) {
      return false;
    }
  }

  function openDb() {
    if (!isSupported()) {
      return Promise.reject(new Error('IndexedDB is not available in this browser.'));
    }

    if (dbPromise) {
      return dbPromise;
    }

    dbPromise = new Promise(function (resolve, reject) {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = function () {
        resolve(request.result);
      };

      request.onerror = function () {
        dbPromise = null;
        reject(request.error || new Error('Could not open the media database.'));
      };
    });

    return dbPromise;
  }

  /** Runs one request against the store and resolves with its result. */
  function run(mode, work) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        let transaction;

        try {
          transaction = db.transaction(STORE_NAME, mode);
        } catch (error) {
          reject(error);
          return;
        }

        const request = work(transaction.objectStore(STORE_NAME));

        transaction.oncomplete = function () {
          resolve(request ? request.result : undefined);
        };
        transaction.onerror = function () {
          reject(transaction.error || new Error('Media storage failed.'));
        };
        transaction.onabort = function () {
          reject(transaction.error || new Error('Media storage failed.'));
        };
      });
    });
  }

  function put(id, blob) {
    return run('readwrite', function (store) {
      return store.put(blob, id);
    });
  }

  function get(id) {
    return run('readonly', function (store) {
      return store.get(id);
    }).then(function (value) {
      return value || null;
    });
  }

  function remove(id) {
    return run('readwrite', function (store) {
      return store.delete(id);
    });
  }

  function clear() {
    return run('readwrite', function (store) {
      return store.clear();
    });
  }

  App.mediaStore = {
    isSupported: isSupported,
    put: put,
    get: get,
    remove: remove,
    clear: clear
  };
})(window.MyTasks);
