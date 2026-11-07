/* ============================================================
   tasks.js — task state and CRUD operations (single source of truth)
   ============================================================ */

window.MyTasks = window.MyTasks || {};

(function (App) {
  'use strict';

  const listeners = new Set();

  /** @type {Array<Object>} in-memory task list */
  let tasks = [];

  function emit(event) {
    listeners.forEach(function (listener) {
      try {
        listener(event);
      } catch (error) {
        console.error('A task listener failed:', error);
      }
    });
  }

  function persist() {
    const saved = App.storage.saveTasks(tasks);
    if (!saved) {
      App.notifications.show(
        'Your changes could not be saved. Local storage may be full or blocked.',
        'error',
        5000
      );
    }
    return saved;
  }

  /** Loads tasks from LocalStorage, cleaning and de-duplicating them. */
  function init() {
    const stored = App.storage.loadTasks();
    const seenIds = new Set();

    tasks = stored
      .map(function (raw) {
        return App.utils.normalizeTask(raw);
      })
      .filter(function (task) {
        if (!task) {
          return false;
        }
        if (seenIds.has(task.id)) {
          return false;
        }
        seenIds.add(task.id);
        return true;
      });

    return tasks.length;
  }

  /** Validates raw form input. Returns { values, errors }. */
  function validateInput(input) {
    const source = input || {};
    const errors = {};

    const title = App.utils.normalizeTitle(source.title);
    const description = App.utils.normalizeText(source.description);
    const dueDate = App.utils.normalizeText(source.dueDate);
    const priority = source.priority;
    const category = source.category;

    if (!title) {
      errors.title = 'Task title is required.';
    } else if (title.length > 120) {
      errors.title = 'Task title must be 120 characters or fewer.';
    }

    if (description.length > 500) {
      errors.description = 'Description must be 500 characters or fewer.';
    }

    if (dueDate && !App.utils.isValidDateString(dueDate)) {
      errors.dueDate = 'Please choose a valid due date.';
    }

    if (App.utils.PRIORITIES.indexOf(priority) === -1) {
      errors.priority = 'Please choose a valid priority.';
    }

    if (App.utils.CATEGORIES.indexOf(category) === -1) {
      errors.category = 'Please choose a valid category.';
    }

    return {
      errors: errors,
      values: {
        title: title,
        description: description,
        dueDate: dueDate,
        priority: priority,
        category: category
      }
    };
  }

  // Attachments are stored as blobs in IndexedDB, so the ceiling is a
  // practical one instead of the ~5MB LocalStorage text quota.
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const MAX_IMAGE_BYTES = 1200000; // photos above this get re-encoded first
  const VALID_MEDIA_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'video/mp4',
    'video/webm'
  ];
  const MAX_IMAGE_SIDE = 1400;

  /**
   * Shrinks large photos before they are stored. Returns the original file
   * whenever re-encoding would not help (GIFs, videos, failures).
   */
  function prepareMedia(file) {
    if (file.type.indexOf('image/') !== 0 || file.type === 'image/gif') {
      return Promise.resolve(file);
    }

    return new Promise(function (resolve) {
      const objectUrl = URL.createObjectURL(file);
      const image = new Image();
      let settled = false;

      function finish(result) {
        if (settled) {
          return;
        }
        settled = true;
        URL.revokeObjectURL(objectUrl);
        resolve(result);
      }

      image.onload = function () {
        try {
          const longestSide = Math.max(image.width, image.height) || 1;
          const scale = Math.min(1, MAX_IMAGE_SIDE / longestSide);

          if (scale === 1 && file.size <= MAX_IMAGE_BYTES) {
            finish(file);
            return;
          }

          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));

          const context = canvas.getContext('2d');
          if (!context) {
            finish(file);
            return;
          }
          context.drawImage(image, 0, 0, canvas.width, canvas.height);

          const qualities = [0.85, 0.7, 0.55];
          let index = 0;

          (function encode() {
            canvas.toBlob(
              function (blob) {
                if (!blob) {
                  finish(file);
                  return;
                }

                const smallEnough = blob.size <= MAX_IMAGE_BYTES || index === qualities.length - 1;
                if (smallEnough) {
                  finish(blob.size < file.size ? blob : file);
                  return;
                }

                index += 1;
                encode();
              },
              'image/jpeg',
              qualities[index]
            );
          })();
        } catch (error) {
          finish(file);
        }
      };

      image.onerror = function () {
        finish(file);
      };

      image.src = objectUrl;
    });
  }

  function create(input) {
    const result = validateInput(input);

    if (Object.keys(result.errors).length > 0) {
      return { ok: false, errors: result.errors };
    }

    const now = new Date().toISOString();

    // Accept either a single File or a FileList from the form.
    const mediaInput = input && input.image;
    const mediaFile =
      mediaInput instanceof File
        ? mediaInput
        : mediaInput && mediaInput.length
          ? mediaInput[0]
          : null;

    // Handle image/video file upload
    if (mediaFile) {
      if (VALID_MEDIA_TYPES.indexOf(mediaFile.type) === -1) {
        return {
          ok: false,
          errors: { form: 'Unsupported file type. Use JPG, PNG, GIF, MP4 or WebM.' }
        };
      }

      if (mediaFile.size > MAX_FILE_BYTES) {
        return {
          ok: false,
          errors: { form: 'That file is larger than 50MB.' }
        };
      }

      if (!App.mediaStore || !App.mediaStore.isSupported()) {
        return {
          ok: false,
          errors: {
            form: 'This browser cannot store attachments. Try another browser.'
          }
        };
      }

      const taskId = App.utils.generateId();
      const mediaId = App.utils.generateId();

      prepareMedia(mediaFile)
        .then(function (blob) {
          return App.mediaStore.put(mediaId, blob).then(function () {
            return blob;
          });
        })
        .then(function (blob) {
          const task = {
            id: taskId,
            title: result.values.title,
            description: result.values.description,
            dueDate: result.values.dueDate,
            priority: result.values.priority,
            category: result.values.category,
            completed: false,
            pinned: false,
            createdAt: now,
            updatedAt: now,
            media: {
              id: mediaId,
              type: blob.type || mediaFile.type,
              name: mediaFile.name || '',
              size: blob.size
            }
          };

          tasks.unshift(task);

          if (!persist()) {
            // Roll back so the UI never shows data that was not saved.
            tasks = tasks.filter(function (item) {
              return item.id !== taskId;
            });
            App.mediaStore.remove(mediaId).catch(function () {});
            emit({
              type: 'create-failed',
              message: 'The task could not be saved in this browser.'
            });
            return;
          }

          emit({ type: 'create', task: task });
        })
        .catch(function (error) {
          console.error('Could not store the attachment:', error);
          App.mediaStore.remove(mediaId).catch(function () {});
          emit({
            type: 'create-failed',
            message: 'That file could not be saved. Try a smaller file.'
          });
        });

      // The task appears once the attachment has been stored.
      return { ok: true, pending: true, taskId: taskId };
    }

    // No image/file - create task normally
    const task = {
      id: App.utils.generateId(),
      title: result.values.title,
      description: result.values.description,
      dueDate: result.values.dueDate,
      priority: result.values.priority,
      category: result.values.category,
      completed: false,
      pinned: false,
      createdAt: now,
      updatedAt: now
    };

    tasks.unshift(task);
    persist();
    emit({ type: 'create', task: task });

    return { ok: true, task: task };
  }

  function update(id, input) {
    const task = findById(id);
    if (!task) {
      return { ok: false, errors: { form: 'This task no longer exists.' } };
    }

    const result = validateInput(input);
    if (Object.keys(result.errors).length > 0) {
      return { ok: false, errors: result.errors };
    }

    task.title = result.values.title;
    task.description = result.values.description;
    task.dueDate = result.values.dueDate;
    task.priority = result.values.priority;
    task.category = result.values.category;
    task.updatedAt = new Date().toISOString();

    persist();
    emit({ type: 'update', task: task });

    return { ok: true, task: task };
  }

  function toggle(id) {
    const task = findById(id);
    if (!task) {
      return null;
    }

    task.completed = !task.completed;
    task.updatedAt = new Date().toISOString();

    persist();
    emit({ type: task.completed ? 'complete' : 'reopen', task: task });

    return task;
  }

  /**
   * Pins/unpins a task. A pinned task stays at the top of the list until it
   * is unpinned, whether or not it is completed.
   */
  function togglePin(id) {
    const task = findById(id);
    if (!task) {
      return null;
    }

    task.pinned = !task.pinned;
    task.updatedAt = new Date().toISOString();

    persist();
    emit({ type: task.pinned ? 'pin' : 'unpin', task: task });

    return task;
  }

  /** Drops the stored blob that belongs to a task being removed. */
  function discardMedia(media) {
    if (media && typeof media === 'object' && media.id && App.mediaStore) {
      App.mediaStore.remove(media.id).catch(function () {});
    }
  }

  function remove(id) {
    const index = tasks.findIndex(function (task) {
      return task.id === id;
    });

    if (index === -1) {
      return false;
    }

    const removed = tasks.splice(index, 1)[0];
    discardMedia(removed.media);
    persist();
    emit({ type: 'delete', task: removed });

    return true;
  }

  function clearCompleted() {
    const completedCount = tasks.filter(function (task) {
      return task.completed;
    }).length;

    if (completedCount === 0) {
      return 0;
    }

    tasks.forEach(function (task) {
      if (task.completed) {
        discardMedia(task.media);
      }
    });

    tasks = tasks.filter(function (task) {
      return !task.completed;
    });

    persist();
    emit({ type: 'clear-completed', count: completedCount });

    return completedCount;
  }

  function findById(id) {
    return (
      tasks.find(function (task) {
        return task.id === id;
      }) || null
    );
  }

  /** Returns copies so callers cannot mutate internal state directly. */
  function getAll() {
    return tasks.map(function (task) {
      return Object.assign({}, task);
    });
  }

  function getById(id) {
    const task = findById(id);
    return task ? Object.assign({}, task) : null;
  }

  function getStats() {
    const total = tasks.length;
    const completed = tasks.filter(function (task) {
      return task.completed;
    }).length;
    const pending = total - completed;

    return {
      total: total,
      completed: completed,
      pending: pending,
      percent: total === 0 ? 0 : Math.round((completed / total) * 100)
    };
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      return function () {};
    }
    listeners.add(listener);
    return function unsubscribe() {
      listeners.delete(listener);
    };
  }

  App.tasks = {
    init: init,
    create: create,
    update: update,
    toggle: toggle,
    togglePin: togglePin,
    remove: remove,
    clearCompleted: clearCompleted,
    getAll: getAll,
    getById: getById,
    getStats: getStats,
    validateInput: validateInput,
    subscribe: subscribe
  };
})(window.MyTasks);
