(function() {
  'use strict';

  var scriptEl = document.currentScript;
  var BASE = '/';
  if (scriptEl && scriptEl.src) {
    BASE = scriptEl.src.replace(/js\/attachment-preview\.js(\?.*)?$/, '');
  }

  var ASSETS_RE = /\/assets\/files\/.*\.(pdf|pptx|ppt|xlsx|xls)$/i;
  var HELP_CENTER_RE = /\/files\/help-center\//;

  function isAttachmentLink(href) {
    if (!href) return false;
    return HELP_CENTER_RE.test(href) || ASSETS_RE.test(href);
  }

  function getFileType(href) {
    var ext = (href.match(/\.(\w+)$/) || [])[1] || '';
    ext = ext.toLowerCase();
    if (ext === 'pdf') return 'pdf';
    if (ext === 'pptx' || ext === 'ppt') return 'pptx';
    if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
    return 'unknown';
  }

  function getFileName(link) {
    return (link.textContent || '').trim() || (link.href.match(/[^/]+$/) || ['file'])[0];
  }

  function getManifestUrl(fileHref) {
    var match = fileHref.match(/\/files\/help-center\/([^/]+)\/([^/]+)$/);
    if (!match) return null;
    var slug = match[1];
    var fileName = match[2];
    var sanitized = fileName.replace(/[\/\\:*?"<>|]/g, '_').replace(/[\x00-\x1f]/g, '').slice(0, 100);
    var ext = fileName.split('.').pop().toLowerCase();
    var prefix = ext === 'pptx' || ext === 'ppt' ? 'ppt-' : '';
    return BASE + 'img/help-center/' + slug + '/' + prefix + sanitized + '/manifest.json';
  }

  function createCard(type, href, fileName) {
    var icons = { pdf: 'PDF', pptx: 'PPT', xlsx: 'XLS', unknown: 'FILE' };
    var colors = { pdf: '#dc2626', pptx: '#ea580c', xlsx: '#16a34a', unknown: '#6b7280' };
    var card = document.createElement('div');
    card.className = 'att-card';
    card.innerHTML =
      '<div class="att-header">' +
        '<span class="att-badge" style="background:' + colors[type] + '">' + icons[type] + '</span>' +
        '<span class="att-name">' + fileName + '</span>' +
        '<button class="att-btn att-toggle">Collapse</button>' +
        '<a class="att-btn att-dl" href="' + href + '" download="' + fileName + '" target="_blank">Download</a>' +
      '</div>' +
      '<div class="att-body"></div>' +
      '<div class="att-status" style="display:none"></div>';
    return card;
  }

  function loadScript(src) {
    return new Promise(function(ok, fail) {
      var existing = document.querySelector('script[data-att-vendor="' + src + '"]');
      if (existing) { ok(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.setAttribute('data-att-vendor', src);
      s.onload = ok;
      s.onerror = fail;
      document.head.appendChild(s);
    });
  }

  function toggleCard(card, type, href) {
    var toggle = card.querySelector('.att-toggle');
    var body = card.querySelector('.att-body');
    var isOpen = !body.classList.contains('collapsed');
    if (isOpen) {
      body.classList.add('collapsed');
      toggle.textContent = 'Preview';
    } else {
      body.classList.remove('collapsed');
      toggle.textContent = 'Collapse';
      if (!body.hasChildNodes() || body.dataset.loaded !== 'true') {
        renderPreview(card, type, href);
        body.dataset.loaded = 'true';
      }
    }
  }

  function renderPreview(card, type, href) {
    if (type === 'pdf') showPDF(card, href);
    else if (type === 'pptx') showPPTX(card, href);
    else if (type === 'xlsx') showXLSX(card, href);
    else {
      var body = card.querySelector('.att-body');
      body.innerHTML = '<p style="padding:12px;color:#666">This file type cannot be previewed. Please download.</p>';
    }
  }

  function showPDF(card, url) {
    var body = card.querySelector('.att-body');
    body.innerHTML = '<p style="text-align:center;color:#666;padding:20px">Loading PDF...</p>';
    loadScript(BASE + 'js/vendor/pdf.min.js')
      .then(function() {
        pdfjsLib.GlobalWorkerOptions.workerSrc = BASE + 'js/vendor/pdf.worker.min.js';
        return pdfjsLib.getDocument(url).promise;
      })
      .then(function(pdf) {
        body.innerHTML = '';
        var n = Math.min(pdf.numPages, 5);
        for (var i = 1; i <= n; i++) {
          (function(p) {
            pdf.getPage(p).then(function(page) {
              var w = body.clientWidth || 800;
              var vp = page.getViewport({ scale: 1 });
              var scale = w / vp.width;
              vp = page.getViewport({ scale: scale });
              var c = document.createElement('canvas');
              c.width = vp.width; c.height = vp.height;
              c.style.cssText = 'width:100%;height:auto;margin-bottom:8px';
              body.appendChild(c);
              page.render({ canvasContext: c.getContext('2d'), viewport: vp });
            });
          })(i);
        }
        if (pdf.numPages > 5) {
          var d = document.createElement('p');
          d.style.cssText = 'text-align:center;color:#999;font-size:12px;padding:4px';
          d.textContent = 'Showing first 5 of ' + pdf.numPages + ' pages';
          body.appendChild(d);
        }
      })
      .catch(function() {
        body.classList.add('collapsed');
        var st = card.querySelector('.att-status');
        st.style.display = 'block';
        st.innerHTML = '<span style="color:#dc2626">Preview failed. Please download the file.</span>';
      });
  }

  function showPptxWithManifest(card, manifest) {
    var body = card.querySelector('.att-body');
    body.innerHTML = '';

    if (manifest.thumbnailUrl) {
      var coverDiv = document.createElement('div');
      coverDiv.className = 'att-cover';
      var img = document.createElement('img');
      img.src = manifest.thumbnailUrl;
      img.alt = (manifest.originalFileName || manifest.displayName || manifest.fileName) + ' cover';
      img.style.maxWidth = '100%';
      coverDiv.appendChild(img);
      body.appendChild(coverDiv);
    }

    if (manifest.mediaImages && manifest.mediaImages.length > 0) {
      var grid = document.createElement('div');
      grid.className = 'att-media-grid';
      manifest.mediaImages.forEach(function(imgUrl) {
        var slideImg = document.createElement('img');
        slideImg.src = imgUrl;
        slideImg.alt = 'Slide content';
        slideImg.loading = 'lazy';
        grid.appendChild(slideImg);
      });
      body.appendChild(grid);
    }

    if (manifest.slideCount) {
      var info = document.createElement('p');
      info.style.cssText = 'text-align:center;color:#999;font-size:12px;padding:8px 0';
      info.textContent = '\u5171 ' + manifest.slideCount + ' \u9875\u5e7b\u706f\u7247';
      body.appendChild(info);
    }
  }

  function findThumbnailImg(card) {
    var container = card.closest('article') || card.closest('.theme-doc-markdown') || card.parentElement;
    if (!container) return null;
    var imgs = container.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var src = imgs[i].getAttribute('src') || '';
      if (src.indexOf('thumbnail') !== -1) return imgs[i];
    }
    return null;
  }

  function showPPTX(card, url) {
    var body = card.querySelector('.att-body');
    body.innerHTML = '<p style="text-align:center;color:#666;padding:20px">Loading PPT...</p>';

    var manifestUrl = getManifestUrl(url);
    var manifestPromise = manifestUrl
      ? fetch(manifestUrl).then(function(r) {
          if (!r.ok) throw new Error('manifest not found');
          return r.json();
        })
      : Promise.reject(new Error('no manifest url'));

    manifestPromise
      .then(function(manifest) {
        var displayName = manifest.originalFileName || manifest.displayName || manifest.fileName;
        if (displayName) {
          var nameEl = card.querySelector('.att-name');
          if (nameEl) nameEl.textContent = displayName;
          var dlEl = card.querySelector('.att-dl');
          if (dlEl) dlEl.setAttribute('download', displayName);
        }
        if (manifest && (manifest.thumbnailUrl || (manifest.mediaImages && manifest.mediaImages.length > 0))) {
          showPptxWithManifest(card, manifest);
        } else {
          throw new Error('manifest has no images');
        }
      })
      .catch(function() {
        body.innerHTML = '<p style="text-align:center;color:#666;padding:20px">Loading PPT...</p>';
        loadScript(BASE + 'js/vendor/pptx-preview.umd.js')
          .then(function() {
            body.innerHTML = '';
            var box = document.createElement('div');
            box.style.cssText = 'width:100%;min-height:300px';
            body.appendChild(box);
            return fetch(url).then(function(r) { return r.arrayBuffer(); }).then(function(buf) {
              var pv = PptxPreview.init(box, {
                width: box.offsetWidth || 800,
                height: Math.min((box.offsetWidth || 800) * 0.5625, 600),
                mode: 'list'
              });
              return pv.preview(buf);
            });
          })
          .catch(function() {
            body.innerHTML = '';
            var thumb = findThumbnailImg(card);
            if (thumb) {
              var clone = thumb.cloneNode(true);
              clone.style.cssText = 'max-width:100%;height:auto;border-radius:4px;margin-bottom:8px';
              body.appendChild(clone);
              var note = document.createElement('p');
              note.style.cssText = 'text-align:center;color:#666;font-size:12px;padding:4px';
              note.textContent = 'Slide preview (thumbnail). Download the file for full content.';
              body.appendChild(note);
            } else {
              body.classList.add('collapsed');
              var st = card.querySelector('.att-status');
              st.style.display = 'block';
              st.innerHTML = '<span style="color:#dc2626">Preview unavailable. Please download the file.</span>';
            }
          });
      });
  }

  function showXLSX(card, url) {
    var body = card.querySelector('.att-body');
    body.innerHTML = '<p style="text-align:center;color:#666;padding:20px">Loading Excel...</p>';
    loadScript(BASE + 'js/vendor/xlsx.full.min.js')
      .then(function() {
        return fetch(url).then(function(r) { return r.arrayBuffer(); });
      })
      .then(function(buf) {
        var wb = XLSX.read(buf, { type: 'array' });
        body.innerHTML = '';
        var names = wb.SheetNames;
        if (names.length > 1) {
          var tabs = document.createElement('div');
          tabs.className = 'att-tabs';
          names.forEach(function(nm, i) {
            var b = document.createElement('button');
            b.textContent = nm;
            if (i === 0) b.className = 'active';
            b.onclick = function() {
              tabs.querySelectorAll('button').forEach(function(x) { x.className = ''; });
              b.className = 'active';
              render(wb.Sheets[nm]);
            };
            tabs.appendChild(b);
          });
          body.appendChild(tabs);
        }
        var tbl = document.createElement('div');
        tbl.className = 'att-table-wrap';
        body.appendChild(tbl);
        function render(sheet) {
          var range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
          var lastRow = Math.min(range.e.r, range.s.r + 10);
          var orig = sheet['!ref'];
          sheet['!ref'] = XLSX.utils.encode_col(range.s.c) + (range.s.r + 1) + ':' +
            XLSX.utils.encode_col(range.e.c) + (lastRow + 1);
          tbl.innerHTML = XLSX.utils.sheet_to_html(sheet);
          sheet['!ref'] = orig;
          if (range.e.r - range.s.r > 10) {
            var p = document.createElement('p');
            p.style.cssText = 'text-align:center;color:#999;font-size:12px;padding:6px;border-top:1px solid #e5e7eb';
            p.textContent = 'Showing 10 of ' + (range.e.r - range.s.r + 1) + ' rows';
            tbl.appendChild(p);
          }
        }
        render(wb.Sheets[names[0]]);
      })
      .catch(function() {
        body.classList.add('collapsed');
        var st = card.querySelector('.att-status');
        st.style.display = 'block';
        st.innerHTML = '<span style="color:#dc2626">Preview failed. Please download the file.</span>';
      });
  }

  function enhance() {
    document.querySelectorAll('.theme-doc-markdown a[href]').forEach(function(link) {
      if (link.getAttribute('data-att-enhanced') === 'true') return;
      var href = link.getAttribute('href') || '';
      if (!isAttachmentLink(href)) return;
      if (link.closest('.att-card')) return;

      link.setAttribute('data-att-enhanced', 'true');

      var type = getFileType(href);
      var name = getFileName(link);
      var card = createCard(type, href, name);

      var parent = link.parentElement;
      if (parent && parent.tagName === 'P' && parent.childNodes.length === 1) {
        parent.replaceWith(card);
      } else {
        link.replaceWith(card);
      }

      var toggle = card.querySelector('.att-toggle');
      toggle.onclick = function() {
        toggleCard(card, type, href);
      };

      renderPreview(card, type, href);
    });
  }

  var css = document.createElement('style');
  css.textContent = [
    '.att-card{border:1px solid #e5e7eb;border-radius:8px;margin:16px 0;overflow:hidden;font-family:system-ui,sans-serif}',
    '.att-header{display:flex;align-items:center;gap:8px;padding:10px 16px;background:#f9fafb;border-bottom:1px solid #e5e7eb}',
    '.att-badge{color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;flex-shrink:0}',
    '.att-name{font-size:14px;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.att-btn{background:none;border:1px solid #d1d5db;border-radius:6px;padding:4px 12px;font-size:13px;cursor:pointer;color:#374151;text-decoration:none;white-space:nowrap}',
    '.att-btn:hover{background:#f3f4f6}',
    '.att-body{padding:12px}',
    '.att-body.collapsed{display:none}',
    '.att-status{padding:8px 16px;font-size:12px}',
    '.att-cover{text-align:center;margin-bottom:12px}',
    '.att-cover img{max-width:100%;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.1)}',
    '.att-media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}',
    '.att-media-grid img{width:100%;border-radius:4px;border:1px solid #e5e7eb;cursor:pointer}',
    '.att-tabs{display:flex;gap:4px;margin-bottom:8px;border-bottom:1px solid #e5e7eb}',
    '.att-tabs button{background:none;border:none;padding:6px 12px;font-size:13px;cursor:pointer;color:#6b7280}',
    '.att-tabs button.active{color:#1d4ed8;border-bottom:2px solid #1d4ed8;font-weight:500}',
    '.att-table-wrap{overflow:auto;max-height:400px}',
    '.att-table-wrap table{width:100%;border-collapse:collapse;font-size:13px}',
    '.att-table-wrap td,.att-table-wrap th{border:1px solid #e5e7eb;padding:4px 8px;white-space:nowrap}',
    '.att-table-wrap th{background:#f9fafb;font-weight:500}'
  ].join('\n');
  document.head.appendChild(css);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhance);
  } else {
    enhance();
  }
  document.addEventListener('routeUpdate', enhance);
  new MutationObserver(function(muts) {
    var found = false;
    muts.forEach(function(m) {
      m.addedNodes.forEach(function(n) {
        if (n.nodeType === 1 && n.querySelector && n.querySelector('.theme-doc-markdown a[href]')) found = true;
      });
    });
    if (found) setTimeout(enhance, 100);
  }).observe(document.body, { childList: true, subtree: true });
})();
