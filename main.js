(function () {
  var loaderEl = document.getElementById('loader');
  var content = document.getElementById('content');
  var PAUSE_MS = 800;
  var MAX_COLONS = 8;
  var COLON_BREAK_MS = 120;

  var IMAGES_TO_PRELOAD = [
    // og-image.png used for social preview; optional
    'og-image.png'
  ];

  function preloadImages(urls) {
    return Promise.all(urls.map(function (url) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = resolve;
        img.onerror = resolve;
        img.src = url;
      });
    }));
  }

  function getAllImageUrls() {
    return fetch('data/photos.index.json')
      .then(function (res) { return res.ok ? res.json() : Promise.reject(); })
      .then(function (data) {
        var photos = (data && data.photos) ? data.photos : [];
        return photos.map(function (p) { return p.src; }).filter(Boolean);
      })
      .catch(function () { return []; });
  }

  function showContent() {
    if (loaderEl) loaderEl.textContent = (loaderEl ? loaderEl.textContent : ':') + ')';
    setTimeout(function () {
      if (loaderEl) loaderEl.classList.add('hidden');
      if (content) content.classList.add('visible');
    }, PAUSE_MS);
  }

  function init() {
    var displayedColons = 0;
    var preloadDone = false;

    var tick = setInterval(function () {
      if (displayedColons < MAX_COLONS) {
        displayedColons++;
        if (loaderEl) loaderEl.textContent = ':'.repeat(displayedColons);
      }
      if (preloadDone && displayedColons >= MAX_COLONS) {
        clearInterval(tick);
        showContent();
      }
    }, COLON_BREAK_MS);

    getAllImageUrls().then(function (photoSrcs) {
      var urls = IMAGES_TO_PRELOAD;
      return preloadImages(urls);
    }).then(function () {
      preloadDone = true;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

(function () {
  var GRID_COLS = 10;
  var GRID_ROWS = 8;
  var IMG_SIZE = 100;
  var MOBILE_IMG_SIZE = 260;
  var MIN_IMAGES = 3;
  var MAX_IMAGES = 7;
  var MOBILE_MAX_IMAGES = 5;
  var MOBILE_IMG_POOL_SIZE = 5;

  var container = document.getElementById('grid-compositions');
  var photoList = [];
  var lastCellId = null;
  var lastRenderX = null;
  var lastRenderY = null;
  var IMG_POOL_SIZE = 7;
  var imgPool = [];
  var MIN_MOVE_PX = 12;
  var cursorHasMoved = false;
  var mobileCycleInterval = null;
  var desktopCycleInterval = null;
  var mobileCycleTimeout = null;
  var mobileCycleRAF = null;
  var MOBILE_BREAKPOINT = 768;
  var MOBILE_LAYOUT_BREAKPOINT = 1200;
  var PHONE_VIEWPORT_BREAKPOINT = 600;
  var MOBILE_CYCLE_MS = 2000;
  var DESKTOP_CYCLE_MS = 4000;

  function getImgSize() {
    var w = window.innerWidth;
    var h = window.innerHeight;
    if (w < PHONE_VIEWPORT_BREAKPOINT) {
      return Math.min(w, h) / 5;
    }
    return w < MOBILE_LAYOUT_BREAKPOINT ? MOBILE_IMG_SIZE : IMG_SIZE;
  }
  /* Match content padding: clamp(1.5rem, 4vw, 3rem) */
  function getContentMarginPx() {
    var w = window.innerWidth;
    var rem = 16;
    var minPx = 1.5 * rem;
    var maxPx = 3 * rem;
    var vwPx = (w * 4) / 100;
    return Math.min(maxPx, Math.max(minPx, vwPx));
  }
  function getImgGap() {
    return getContentMarginPx();
  }
  function getEdgeMargin() {
    return getContentMarginPx();
  }
  function getPoolSize() { return window.innerWidth < MOBILE_LAYOUT_BREAKPOINT ? MOBILE_IMG_POOL_SIZE : IMG_POOL_SIZE; }
  function getMaxImages() { return window.innerWidth < MOBILE_LAYOUT_BREAKPOINT ? MOBILE_MAX_IMAGES : MAX_IMAGES; }

  function isMobile() {
    return window.innerWidth < MOBILE_BREAKPOINT || ('ontouchstart' in window && window.innerWidth < 1024);
  }

  function ensureImgPool() {
    var poolSize = getPoolSize();
    if (imgPool.length >= poolSize) return;
    for (var i = imgPool.length; i < poolSize; i++) {
      var img = document.createElement('img');
      img.className = 'comp-img';
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = function () { this.style.display = 'none'; };
      imgPool.push(img);
      if (container) container.appendChild(img);
    }
  }

  function getCellId(clientX, clientY) {
    var w = window.innerWidth;
    var h = window.innerHeight;
    if (w <= 0 || h <= 0) return 0;
    var cellX = Math.floor((clientX / w) * GRID_COLS);
    var cellY = Math.floor((clientY / h) * GRID_ROWS);
    cellX = Math.max(0, Math.min(GRID_COLS - 1, cellX));
    cellY = Math.max(0, Math.min(GRID_ROWS - 1, cellY));
    return cellY * GRID_COLS + cellX;
  }

  function sample(arr, n) {
    var copy = arr.slice();
    var out = [];
    for (var i = 0; i < n && copy.length > 0; i++) {
      var j = Math.floor(Math.random() * copy.length);
      out.push(copy[j]);
      copy.splice(j, 1);
    }
    return out;
  }

  function cellOverlapsContent(cellCol, cellRow, contentRect, cols, rows) {
    var imgSize = getImgSize();
    var gap = getImgGap();
    var edgeMargin = getEdgeMargin();
    var cellSize = imgSize + gap;
    var imgLeft = edgeMargin + cellCol * cellSize;
    var imgTop = edgeMargin + cellRow * cellSize;
    var imgRight = imgLeft + imgSize;
    var imgBottom = imgTop + imgSize;
    return imgLeft < contentRect.right && imgRight > contentRect.left &&
      imgTop < contentRect.bottom && imgBottom > contentRect.top;
  }

  function renderComposition() {
    if (!container || photoList.length === 0) return;
    var imgSize = getImgSize();
    var poolSize = getPoolSize();
    var maxImages = getMaxImages();
    var w = window.innerWidth;
    var h = window.innerHeight;
    var edgeMargin = getEdgeMargin();
    var innerW = Math.max(0, w - 2 * edgeMargin);
    var innerH = Math.max(0, h - 2 * edgeMargin);
    var gap = getImgGap();
    var cellSize = imgSize + gap;
    var cols = Math.max(1, Math.floor(innerW / cellSize));
    var rows = Math.max(1, Math.floor(innerH / cellSize));
    var maxLeft = Math.max(0, w - imgSize - edgeMargin);
    var maxTop = Math.max(0, h - imgSize - edgeMargin);
    var totalCells = cols * rows;

    var count = MIN_IMAGES + Math.floor(Math.random() * (maxImages - MIN_IMAGES + 1));
    count = Math.min(count, photoList.length, totalCells, maxImages);
    count = Math.min(totalCells, Math.max(MIN_IMAGES, count));

    var chosen = sample(photoList, count);

    var contentRect = null;
    if (!cursorHasMoved) {
      var contentEl = document.getElementById('content');
      if (contentEl) contentRect = contentEl.getBoundingClientRect();
    }

    var leftColumnIndices = [];
    var otherIndices = [];
    for (var c = 0; c < totalCells; c++) {
      var col = c % cols;
      var row = Math.floor(c / cols);
      if (contentRect && cellOverlapsContent(col, row, contentRect, cols, rows)) continue;
      if (col < 2) leftColumnIndices.push(c);
      else otherIndices.push(c);
    }
    for (var i = otherIndices.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = otherIndices[i];
      otherIndices[i] = otherIndices[j];
      otherIndices[j] = tmp;
    }
    for (var i = leftColumnIndices.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = leftColumnIndices[i];
      leftColumnIndices[i] = leftColumnIndices[j];
      leftColumnIndices[j] = tmp;
    }
    var leftCount = Math.min(2, leftColumnIndices.length, count);
    var cellIndices = leftColumnIndices.slice(0, leftCount).concat(otherIndices.slice(0, count - leftCount));
    count = Math.min(count, cellIndices.length);
    chosen = chosen.slice(0, count);

    ensureImgPool();

    var maxLeftFinal = maxLeft;
    var maxTopFinal = maxTop;
    var cellSizeFinal = cellSize;
    var toPreload = [];
    var toUpdateSameSrc = [];
    var toHide = [];

    for (var i = 0; i < poolSize; i++) {
      var img = imgPool[i];
      if (i < chosen.length) {
        var idx = cellIndices[i];
        var cellCol = idx % cols;
        var cellRow = Math.floor(idx / cols);
        var left = Math.min(edgeMargin + cellCol * cellSizeFinal, maxLeftFinal);
        var top = Math.min(edgeMargin + cellRow * cellSizeFinal, maxTopFinal);
        var newSrc = chosen[i];
        var resolvedNew = '';
        try { resolvedNew = new URL(newSrc, window.location.href).href; } catch (e) {}
        var sameSrc = (img.src && resolvedNew && img.src === resolvedNew);
        if (sameSrc) {
          toUpdateSameSrc.push({ img: img, left: left, top: top });
        } else {
          toPreload.push({ img: img, newSrc: newSrc, left: left, top: top });
        }
      } else {
        toHide.push(img);
      }
    }

    function applyComposition() {
      var pending = toPreload.length;
      if (pending === 0) {
        flushComposition();
        return;
      }
      toPreload.forEach(function (item) {
        var img = item.img;
        var newSrc = item.newSrc;
        var left = item.left;
        var top = item.top;
        var temp = new Image();
        temp.onload = temp.onerror = function () {
          img.src = newSrc;
          img.style.left = left + 'px';
          img.style.top = top + 'px';
          img.style.opacity = '1';
          img.style.display = '';
          img.onload = null;
          img.onerror = null;
          pending--;
          if (pending === 0) flushComposition();
        };
        temp.src = newSrc;
      });
    }

    function flushComposition() {
      toUpdateSameSrc.forEach(function (item) {
        item.img.style.left = item.left + 'px';
        item.img.style.top = item.top + 'px';
        item.img.style.opacity = '1';
        item.img.style.display = '';
      });
      toHide.forEach(function (img) {
        img.style.display = 'none';
      });
      for (var j = poolSize; j < imgPool.length; j++) {
        imgPool[j].style.display = 'none';
      }
    }

    applyComposition();
  }

  function onMouseMove(e) {
    if (!cursorHasMoved) {
      cursorHasMoved = true;
      renderComposition();
      return;
    }
    var cellId = getCellId(e.clientX, e.clientY);
    var dx = lastRenderX != null ? e.clientX - lastRenderX : MIN_MOVE_PX;
    var dy = lastRenderY != null ? e.clientY - lastRenderY : MIN_MOVE_PX;
    var movedEnough = (dx * dx + dy * dy) >= (MIN_MOVE_PX * MIN_MOVE_PX);
    if (cellId !== lastCellId && movedEnough) {
      lastCellId = cellId;
      lastRenderX = e.clientX;
      lastRenderY = e.clientY;
      renderComposition();
    }
  }

  function onResize() {
    lastCellId = null;
    lastRenderX = null;
    lastRenderY = null;
    if (isMobile()) {
      document.removeEventListener('mousemove', onMouseMove);
      stopDesktopCycle();
      startMobileCycle();
    } else {
      stopMobileCycle();
      stopDesktopCycle();
      document.addEventListener('mousemove', onMouseMove);
    }
    if (container) {
      container.innerHTML = '';
      imgPool = [];
    }
  }

  function initGrid() {
    if (!container) return;
    fetch('data/photos.index.json')
      .then(function (res) { return res.ok ? res.json() : Promise.reject(); })
      .then(function (data) {
        var photos = (data && data.photos) ? data.photos : [];
        photoList = photos.map(function (p) { return p.src; }).filter(Boolean);
      })
      .catch(function () { photoList = []; })
      .then(function () {
        var fallback = 'data:image/gif;base64,R0lGOODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        while (photoList.length < MIN_IMAGES) {
          photoList.push(fallback);
        }
        if (isMobile()) {
          startMobileCycle();
        } else {
          document.addEventListener('mousemove', onMouseMove);
        }
        window.addEventListener('resize', onResize);
        renderComposition();
      });
  }

  function cycleComposition() {
    if (!container || photoList.length === 0) return;
    renderComposition();
  }

  function startMobileCycle() {
    stopMobileCycle();
    cycleComposition();
    mobileCycleInterval = setInterval(function () {
      cycleComposition();
    }, MOBILE_CYCLE_MS);
  }

  function stopMobileCycle() {
    if (mobileCycleRAF != null) {
      cancelAnimationFrame(mobileCycleRAF);
      mobileCycleRAF = null;
    }
    if (mobileCycleTimeout) {
      clearTimeout(mobileCycleTimeout);
      mobileCycleTimeout = null;
    }
    if (mobileCycleInterval) {
      clearInterval(mobileCycleInterval);
      mobileCycleInterval = null;
    }
  }

  function startDesktopCycle() {
    stopDesktopCycle();
    desktopCycleInterval = setInterval(function () {
      cycleComposition();
    }, DESKTOP_CYCLE_MS);
  }

  function stopDesktopCycle() {
    if (desktopCycleInterval) {
      clearInterval(desktopCycleInterval);
      desktopCycleInterval = null;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGrid);
  } else {
    initGrid();
  }
})();

(function () {
  var LEAVE_DURATION_MS = 450;
  var exploreLink = document.getElementById('finished');
  var stalkLink = document.getElementById('stalk');

  function smoothLeave(e, link) {
    if (!link || !link.href || link.target === '_blank') return;
    e.preventDefault();
    document.body.classList.add('leaving');
    setTimeout(function () {
      window.location.href = link.href;
    }, LEAVE_DURATION_MS);
  }

  if (exploreLink) {
    exploreLink.addEventListener('click', function (e) { smoothLeave(e, exploreLink); });
  }
  if (stalkLink) {
    stalkLink.addEventListener('click', function (e) { smoothLeave(e, stalkLink); });
  }
})();
