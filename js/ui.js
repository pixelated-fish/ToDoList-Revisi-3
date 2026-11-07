/* ============================================================
   ui.js — DOM rendering, dialogs, theme and form feedback
   ============================================================ */

window.MyTasks = window.MyTasks || {};

(function (App) {
  'use strict';

  const els = {};
  const THEME_COLORS = { light: '#F5F6FA', dark: '#0B1120' };

  let editingTaskId = null;
  let confirmResolver = null;
  let lastLightboxTrigger = null;

  /** Caches every element the module touches. */
  function cacheElements() {
    els.currentDate = document.getElementById('current-date');
    els.pendingCount = document.getElementById('pending-count');
    els.themeToggle = document.getElementById('theme-toggle');

    els.statTotal = document.getElementById('stat-total');
    els.statCompleted = document.getElementById('stat-completed');
    els.statPending = document.getElementById('stat-pending');

    els.progressTrack = document.getElementById('progress-track');
    els.progressFill = document.getElementById('progress-fill');
    els.progressPercent = document.getElementById('progress-percent');
    els.progressHint = document.getElementById('progress-hint');

    els.taskList = document.getElementById('task-list');
    els.taskTemplate = document.getElementById('task-template');
    els.emptyState = document.getElementById('empty-state');
    els.emptyTitle = document.getElementById('empty-title');
    els.emptyText = document.getElementById('empty-text');

    els.visibleCount = document.getElementById('visible-count');
    els.statusFilters = document.getElementById('status-filters');
    els.statusButtons = Array.prototype.slice.call(
      document.querySelectorAll('#status-filters [data-status]')
    );
    els.clearCompleted = document.getElementById('clear-completed');
    els.clearCompletedCount = document.getElementById('clear-completed-count');
    els.searchInput = document.getElementById('search-input');
    els.categoryFilter = document.getElementById('category-filter');
    els.sortSelect = document.getElementById('sort-select');

    els.taskForm = document.getElementById('task-form');
    els.taskFormError = document.getElementById('form-error');
    els.titleInput = document.getElementById('task-title');
    els.titleError = document.getElementById('title-error');

    els.editDialog = document.getElementById('edit-dialog');
    els.editForm = document.getElementById('edit-form');
    els.editError = document.getElementById('edit-error');
    els.editClose = document.getElementById('edit-close');
    els.editCancel = document.getElementById('edit-cancel');

    els.confirmDialog = document.getElementById('confirm-dialog');
    els.confirmTitle = document.getElementById('confirm-title');
    els.confirmMessage = document.getElementById('confirm-message');
    els.confirmOk = document.getElementById('confirm-ok');
    els.confirmCancel = document.getElementById('confirm-cancel');

    els.lightbox = document.getElementById('media-lightbox');
    els.lightboxContent = document.getElementById('lightbox-content');
    els.lightboxCaption = document.getElementById('lightbox-caption');
    els.lightboxClose = document.getElementById('lightbox-close');
  }

  function init() {
    cacheElements();
    els.currentDate.textContent = App.utils.formatToday();
    bindDialogEvents();
  }

  function elements() {
    return els;
  }

  /* ------------------------------------------------------------
     Rendering
     ------------------------------------------------------------ */

  function render(state) {
    releaseUnusedMediaUrls(state.tasks);
    renderStats(state.stats);
    renderProgress(state.stats);
    renderToolbar(state.filters, state.stats);
    renderTaskList(state.visible, state.tasks);
  }

  function renderStats(stats) {
    els.statTotal.textContent = String(stats.total);
    els.statCompleted.textContent = String(stats.completed);
    els.statPending.textContent = String(stats.pending);
    els.pendingCount.textContent = String(stats.pending);
  }

  function renderProgress(stats) {
    const fill = els.progressFill;

    fill.style.width = stats.percent + '%';
    els.progressTrack.setAttribute('aria-valuenow', String(stats.percent));
    els.progressPercent.textContent = stats.percent + '%';

    // Restart the sweep + pulse animation on every update so the bar visibly
    // reacts to completing, re-opening or cancelling a task.
    fill.classList.remove('animating');
    void fill.offsetWidth; // force a reflow so the animation can restart
    fill.classList.add('animating');

    if (stats.total === 0) {
      els.progressHint.textContent = 'Add a task to start tracking progress.';
    } else if (stats.completed === stats.total) {
      els.progressHint.textContent = 'All tasks completed. Nice work!';
    } else {
      els.progressHint.textContent =
        stats.pending +
        ' ' +
        App.utils.pluralize(stats.pending, 'task') +
        ' left to finish.';
    }
  }

  function renderToolbar(filters, stats) {
    els.statusButtons.forEach(function (button) {
      const isActive = button.dataset.status === filters.status;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    els.clearCompleted.disabled = stats.completed === 0;
    els.clearCompletedCount.textContent = String(stats.completed);
  }

  function renderTaskList(visibleTasks, allTasks) {
    els.taskList.textContent = '';

    const fragment = document.createDocumentFragment();
    visibleTasks.forEach(function (task) {
      fragment.appendChild(createTaskCard(task));
    });
    els.taskList.appendChild(fragment);

    const hasVisibleTasks = visibleTasks.length > 0;
    els.emptyState.hidden = hasVisibleTasks;

    if (!hasVisibleTasks) {
      const isFiltered = allTasks.length > 0;
      els.emptyTitle.textContent = isFiltered ? 'No matching tasks' : 'No tasks yet';
      els.emptyText.textContent = isFiltered
        ? 'Try a different search term, category, or status filter.'
        : 'Add your first task to get started.';
    }

    els.visibleCount.textContent =
      'Showing ' + visibleTasks.length + ' of ' + allTasks.length;
  }

  /** Builds one task card from the <template>. User text uses textContent. */
  function createTaskCard(task) {
    const card = els.taskTemplate.content.firstElementChild.cloneNode(true);
    card.dataset.id = task.id;
    card.classList.toggle('is-completed', task.completed);
    card.classList.toggle('is-pinned', task.pinned === true);

    const checkbox = card.querySelector('.task-checkbox');
    checkbox.checked = task.completed;
    const toggleLabel = task.completed ? 'Mark as active' : 'Mark as completed';
    checkbox.setAttribute('aria-label', toggleLabel + ': ' + task.title);
    checkbox.title = toggleLabel;

    card.querySelector('.task-title').textContent = task.title;

    const description = card.querySelector('.task-description');
    if (task.description) {
      description.textContent = task.description;
    } else {
      description.remove();
    }

    const priorityBadge = card.querySelector('.badge--priority');
    priorityBadge.textContent = App.utils.capitalize(task.priority);
    priorityBadge.classList.add('badge--' + task.priority);

    const categoryBadge = card.querySelector('.badge--category');
    categoryBadge.textContent = App.utils.capitalize(task.category);
    categoryBadge.classList.add('badge--cat-' + task.category);

    const dueElement = card.querySelector('.task-due');
    const formattedDue = App.utils.formatDueDate(task.dueDate);

    if (formattedDue) {
      if (App.utils.isOverdue(task.dueDate, task.completed)) {
        dueElement.textContent = 'Overdue · ' + formattedDue;
        dueElement.classList.add('is-overdue');
      } else if (App.utils.isDueToday(task.dueDate)) {
        dueElement.textContent = 'Due today';
        dueElement.classList.add('is-today');
      } else {
        dueElement.textContent = 'Due ' + formattedDue;
      }
    } else {
      dueElement.remove();
    }

    const createdElement = card.querySelector('.task-created');
    const createdLabel = App.utils.formatCreatedDate(task.createdAt);
    if (createdLabel) {
      createdElement.textContent = 'Added ' + createdLabel;
    } else {
      createdElement.remove();
    }

    // Render media attachment (image or video)
    renderTaskMedia(card, task.media, task.title);

    const editButton = card.querySelector('[data-action="edit"]');
    editButton.title = 'Edit task';
    editButton.setAttribute('aria-label', 'Edit task: ' + task.title);

    const deleteButton = card.querySelector('[data-action="delete"]');
    deleteButton.title = 'Delete task';
    deleteButton.setAttribute('aria-label', 'Delete task: ' + task.title);

    const pinButton = card.querySelector('[data-action="pin"]');
    const pinLabel = task.pinned ? 'Unpin task' : 'Pin task to the top';
    pinButton.title = pinLabel;
    pinButton.setAttribute('aria-label', pinLabel + ': ' + task.title);
    pinButton.setAttribute('aria-pressed', task.pinned ? 'true' : 'false');
    pinButton.classList.toggle('is-active', task.pinned === true);

    return card;
  }

  const ZOOM_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M15 3h6v6" /><path d="M9 21H3v-6" />' +
    '<path d="M21 3l-7 7" /><path d="M3 21l7-7" /></svg>';

  /** Blob URLs created for stored attachments, keyed by media id. */
  const mediaUrlCache = new Map();

  /**
   * Turns a task attachment into something <img>/<video> can use. Older
   * tasks hold a data URL, newer ones a blob id in IndexedDB.
   */
  function getMediaUrl(media) {
    if (!media) {
      return Promise.resolve('');
    }

    if (typeof media === 'string') {
      return Promise.resolve(media);
    }

    if (!media.id || !App.mediaStore) {
      return Promise.resolve('');
    }

    const cached = mediaUrlCache.get(media.id);
    if (cached) {
      return Promise.resolve(cached);
    }

    return App.mediaStore
      .get(media.id)
      .then(function (blob) {
        if (!blob) {
          return '';
        }
        const url = URL.createObjectURL(blob);
        mediaUrlCache.set(media.id, url);
        return url;
      })
      .catch(function (error) {
        console.error('Could not load the attachment:', error);
        return '';
      });
  }

  /** Releases blob URLs whose attachments no longer exist. */
  function releaseUnusedMediaUrls(tasks) {
    const used = new Set();

    tasks.forEach(function (task) {
      if (task.media && typeof task.media === 'object' && task.media.id) {
        used.add(task.media.id);
      }
    });

    mediaUrlCache.forEach(function (url, id) {
      if (!used.has(id)) {
        URL.revokeObjectURL(url);
        mediaUrlCache.delete(id);
      }
    });
  }

  function isVideoMedia(media) {
    if (typeof media === 'string') {
      return /^data:video\//i.test(media);
    }
    return !!media && typeof media.type === 'string' && media.type.indexOf('video/') === 0;
  }

  /** Renders media (image/video) inside a task card. */
  function renderTaskMedia(card, media, taskTitle) {
    const taskBody = card.querySelector('.task-body');
    if (!taskBody || !media) {
      return;
    }

    getMediaUrl(media).then(function (mediaUrl) {
      // The list was re-rendered while the attachment was loading.
      if (!mediaUrl || !card.isConnected) {
        return;
      }

      renderTaskMediaElement(card, taskBody, mediaUrl, media, taskTitle);
    });
  }

  function renderTaskMediaElement(card, taskBody, mediaUrl, media, taskTitle) {
    let mediaContainer = card.querySelector('.task-media');
    if (!mediaContainer) {
      mediaContainer = document.createElement('div');
      mediaContainer.classList.add('task-media');

      const meta = taskBody.querySelector('.task-meta');
      if (meta) {
        taskBody.insertBefore(mediaContainer, meta);
      } else {
        taskBody.appendChild(mediaContainer);
      }
    }

    mediaContainer.textContent = '';

    const isVideo = isVideoMedia(media);
    const caption = taskTitle ? 'Attachment of "' + taskTitle + '"' : 'Attachment';

    if (isVideo) {
      const item = document.createElement('div');
      item.className = 'task-media__item';

      const videoElement = document.createElement('video');
      videoElement.src = mediaUrl;
      videoElement.controls = true;
      videoElement.preload = 'metadata';
      videoElement.className = 'task-media__video';
      videoElement.setAttribute('aria-label', 'Task video attachment');

      const zoomButton = createZoomButton(caption, 'video');
      zoomButton.addEventListener('click', function () {
        openLightbox(mediaUrl, true, caption);
      });

      item.appendChild(videoElement);
      item.appendChild(zoomButton);
      mediaContainer.appendChild(item);
    } else {
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'task-media__item task-media__item--image';
      trigger.setAttribute('aria-label', 'Open image attachment in larger view');

      const imgElement = document.createElement('img');
      imgElement.src = mediaUrl;
      imgElement.alt = caption;
      imgElement.loading = 'lazy';
      imgElement.className = 'task-media__image';

      trigger.appendChild(imgElement);
      trigger.appendChild(createZoomButton(caption, 'image'));
      trigger.addEventListener('click', function () {
        openLightbox(mediaUrl, false, caption);
      });

      mediaContainer.appendChild(trigger);
    }
  }

  /**
   * Zoom badge drawn on top of the media. For videos it is a real button
   * (the video keeps its own controls); for images it is decorative because
   * the whole thumbnail already is a button.
   */
  function createZoomButton(caption, kind) {
    const badge = document.createElement(kind === 'video' ? 'button' : 'span');
    badge.className = 'task-media__zoom';
    badge.innerHTML = ZOOM_ICON;

    if (kind === 'video') {
      badge.type = 'button';
      badge.setAttribute('aria-label', 'Open video attachment in larger view');
      badge.title = 'View video larger';
    } else {
      badge.setAttribute('aria-hidden', 'true');
      badge.title = 'View image larger';
    }

    return badge;
  }

  /**
   * Only one attachment may play at a time: starting a video pauses every
   * other one, so the inline player and the lightbox never overlap.
   */
  function pauseVideos(except) {
    const videos = document.querySelectorAll('video');

    Array.prototype.forEach.call(videos, function (video) {
      if (video !== except && !video.paused) {
        video.pause();
      }
    });
  }

  /* ------------------------------------------------------------
     Attachment lightbox
     ------------------------------------------------------------ */

  function openLightbox(url, isVideo, caption) {
    if (!url) {
      return;
    }

    // Popping the video out stops the inline player so the two never overlap.
    if (isVideo) {
      pauseVideos(null);
    }

    const content = els.lightboxContent;
    content.textContent = '';

    let node;
    if (isVideo) {
      node = document.createElement('video');
      node.src = url;
      node.className = 'lightbox__video';
      node.controls = true;
      node.autoplay = true;
      node.playsInline = true;
      node.setAttribute('aria-label', caption || 'Attachment preview');
    } else {
      node = document.createElement('img');
      node.src = url;
      node.className = 'lightbox__image';
      node.alt = caption || 'Attachment preview';
    }

    content.appendChild(node);
    els.lightboxCaption.textContent = caption || '';
    lastLightboxTrigger = document.activeElement;

    if (typeof els.lightbox.showModal === 'function') {
      els.lightbox.showModal();
    } else {
      els.lightbox.setAttribute('open', '');
    }

    els.lightboxClose.focus();
  }

  function closeLightbox() {
    if (!els.lightbox) {
      return;
    }

    const video = els.lightboxContent.querySelector('video');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }

    els.lightboxContent.textContent = '';

    if (typeof els.lightbox.close === 'function' && els.lightbox.open) {
      els.lightbox.close();
    } else {
      els.lightbox.removeAttribute('open');
    }

    if (lastLightboxTrigger && typeof lastLightboxTrigger.focus === 'function') {
      lastLightboxTrigger.focus();
    }
    lastLightboxTrigger = null;
  }

  /* ------------------------------------------------------------
     Add-task form feedback
     ------------------------------------------------------------ */

  function showFormError(errors) {
    const titleMessage = errors.title || '';
    els.titleError.textContent = titleMessage;

    if (titleMessage) {
      els.titleInput.setAttribute('aria-invalid', 'true');
    } else {
      els.titleInput.removeAttribute('aria-invalid');
    }

    const generalMessage =
      errors.form ||
      errors.description ||
      errors.dueDate ||
      errors.priority ||
      errors.category ||
      '';
    els.taskFormError.textContent = generalMessage;
  }

  function clearFormError() {
    els.titleError.textContent = '';
    els.taskFormError.textContent = '';
    els.titleInput.removeAttribute('aria-invalid');
  }

  /* ------------------------------------------------------------
     Edit dialog
     ------------------------------------------------------------ */

  function openEditModal(task) {
    if (!task) {
      return;
    }

    editingTaskId = task.id;
    els.editForm.reset();
    els.editForm.elements.title.value = task.title;
    els.editForm.elements.description.value = task.description || '';
    els.editForm.elements.dueDate.value = task.dueDate || '';
    els.editForm.elements.priority.value = task.priority;
    els.editForm.elements.category.value = task.category;

    els.editError.textContent = '';
    els.editForm.elements.title.removeAttribute('aria-invalid');

    if (!els.editDialog.open) {
      els.editDialog.showModal();
    }

    els.editForm.elements.title.focus();
    const titleLength = els.editForm.elements.title.value.length;
    els.editForm.elements.title.setSelectionRange(titleLength, titleLength);
  }

  function closeEditModal() {
    editingTaskId = null;
    els.editError.textContent = '';
    if (els.editDialog.open) {
      els.editDialog.close();
    }
  }

  function getEditingTaskId() {
    return editingTaskId;
  }

  function showEditError(errors) {
    const message =
      errors.title ||
      errors.description ||
      errors.dueDate ||
      errors.priority ||
      errors.category ||
      errors.form ||
      'Please review the form and try again.';
    els.editError.textContent = message;

    if (errors.title) {
      els.editForm.elements.title.setAttribute('aria-invalid', 'true');
    } else {
      els.editForm.elements.title.removeAttribute('aria-invalid');
    }
  }

  /* ------------------------------------------------------------
     Confirmation dialog (promise based)
     ------------------------------------------------------------ */

  function openConfirm(options) {
    const settings = options || {};

    // Never stack confirmations: a new request cancels the previous one.
    if (confirmResolver) {
      settleConfirm(false);
    }

    return new Promise(function (resolve) {
      confirmResolver = resolve;
      els.confirmTitle.textContent = settings.title || 'Are you sure?';
      els.confirmMessage.textContent = settings.message || '';
      els.confirmOk.textContent = settings.confirmLabel || 'Confirm';

      if (!els.confirmDialog.open) {
        els.confirmDialog.showModal();
      }

      els.confirmCancel.focus();
    });
  }

  function settleConfirm(value) {
    const resolve = confirmResolver;
    confirmResolver = null;
    if (els.confirmDialog.open) {
      els.confirmDialog.close();
    }
    if (resolve) {
      resolve(value);
    }
  }

  function bindDialogEvents() {
    els.confirmOk.addEventListener('click', function () {
      settleConfirm(true);
    });
    els.confirmCancel.addEventListener('click', function () {
      settleConfirm(false);
    });

    // Escape key closes the dialog without firing a button handler.
    els.confirmDialog.addEventListener('close', function () {
      if (confirmResolver) {
        const resolve = confirmResolver;
        confirmResolver = null;
        resolve(false);
      }
    });

    // Clicking the backdrop counts as a cancel.
    els.confirmDialog.addEventListener('click', function (event) {
      if (event.target === els.confirmDialog) {
        settleConfirm(false);
      }
    });

    els.editClose.addEventListener('click', closeEditModal);
    els.editCancel.addEventListener('click', closeEditModal);
    els.editDialog.addEventListener('click', function (event) {
      if (event.target === els.editDialog) {
        closeEditModal();
      }
    });
    els.editDialog.addEventListener('close', function () {
      editingTaskId = null;
    });

    // The play event does not bubble, but it is catchable in the capture
    // phase, which lets one listener police every attachment player.
    document.addEventListener(
      'play',
      function (event) {
        if (event.target instanceof HTMLVideoElement) {
          pauseVideos(event.target);
        }
      },
      true
    );

    els.lightboxClose.addEventListener('click', closeLightbox);

    // Clicking the backdrop (outside the media frame) closes the preview.
    els.lightbox.addEventListener('click', function (event) {
      if (event.target === els.lightbox) {
        closeLightbox();
      }
    });

    // Escape: close ourselves so the video is paused and the DOM is cleared
    // (the native "close" event is not reliable in every build).
    els.lightbox.addEventListener('cancel', function (event) {
      event.preventDefault();
      closeLightbox();
    });

    // Clean up the video element so it stops loading/playing.
    els.lightbox.addEventListener('close', function () {
      const video = els.lightboxContent.querySelector('video');
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      els.lightboxContent.textContent = '';
    });
  }

  /* ------------------------------------------------------------
     Theme
     ------------------------------------------------------------ */

  function applyTheme(theme) {
    const safeTheme = theme === 'dark' ? 'dark' : 'light';

    document.documentElement.setAttribute('data-theme', safeTheme);
    els.themeToggle.setAttribute('aria-pressed', safeTheme === 'dark' ? 'true' : 'false');
    els.themeToggle.setAttribute(
      'aria-label',
      safeTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
    );

    const metaThemeColor = document.getElementById('meta-theme-color');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', THEME_COLORS[safeTheme]);
    }

    return safeTheme;
  }

  function getTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function showToast(message, type, duration) {
    App.notifications.show(message, type, duration);
  }

  App.ui = {
    init: init,
    elements: elements,
    render: render,
    showFormError: showFormError,
    clearFormError: clearFormError,
    openEditModal: openEditModal,
    closeEditModal: closeEditModal,
    getEditingTaskId: getEditingTaskId,
    showEditError: showEditError,
    openLightbox: openLightbox,
    closeLightbox: closeLightbox,
    pauseVideos: pauseVideos,
    openConfirm: openConfirm,
    applyTheme: applyTheme,
    getTheme: getTheme,
    showToast: showToast
  };
})(window.MyTasks);
