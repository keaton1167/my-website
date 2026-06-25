import { publishApi } from '@client/src/api';
import { resolveAppUrl } from '@lark-apaas/client-toolkit/utils/resolveAppUrl';

export const PREVIEW_BASE = '/api/preview/help-center';

export function buildDraftPreviewUrl(filePath?: string): string {
  if (!filePath) return '';

  let p = filePath.replace(/\\/g, '/');
  p = p.replace(/\.(md|mdx)$/i, '');
  p = p.replace(/\/index$/, '');

  if (p.startsWith('i18n/en/docusaurus-plugin-content-docs/current/')) {
    p = 'en/docs/' + p.replace('i18n/en/docusaurus-plugin-content-docs/current/', '');
  }

  p = p.replace(/^\/+/, '').replace(/\/+$/, '');

  return `${PREVIEW_BASE}/${p}/`;
}

function getCookieValue(name: string): string {
  const match = document.cookie.match(
    new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'),
  );
  return match ? decodeURIComponent(match[1]) : '';
}

function buildNavScript(
  renderBaseUrl: string,
  previewBasePath: string,
  csrfToken: string,
): string {
  return `<script data-preview-nav>
(function() {
  if (window.__previewIntercepted) return;
  window.__previewIntercepted = true;

  var RENDER_BASE = '${renderBaseUrl}';
  var PREVIEW_BASE = '${previewBasePath}';
  var CSRF = '${csrfToken}';
  var RENDER_ORIGIN = RENDER_BASE.replace(/^(https?:\\/\\/[^/]+)[\\s\\S]*$/, '$1');
  var FILE_EXT = /\\.(pdf|zip|xlsx?|docx?|pptx?|csv|tar|gz|rar|7z|mp[34]|mov|avi|wav)(\\?|$)/i;

  window.__previewNavScript = document.querySelector('script[data-preview-nav]')
    ? document.querySelector('script[data-preview-nav]').outerHTML
    : '';

  function navTo(href) {
    var idx = href.indexOf('/api/preview/help-center');
    var rel = idx >= 0 ? href.substring(idx + '/api/preview/help-center'.length) : href;
    rel = rel.replace(/^\\/+/, '').replace(/\\/+$/, '');
    var url = RENDER_BASE + (rel || 'index.html');
    var h = { 'Accept': 'application/json' };
    if (CSRF) h['x-suda-csrf-token'] = CSRF;
    fetch(url, { credentials: 'include', headers: h })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d || !d.html) return;
        var s = window.__previewNavScript;
        var h2 = d.html;
        if (s && h2.indexOf('</body>') !== -1) {
          h2 = h2.replace('</body>', s + '</body>');
        }
        document.open();
        document.write(h2);
        document.close();
        window.scrollTo(0, 0);
      })
      .catch(function(e) { console.error('[Preview] nav failed:', e); });
  }

  document.addEventListener('click', function(e) {
    var a = e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return;
    if (a.hasAttribute('download') || a.target === '_blank') return;
    if (/^javascript:/i.test(href)) return;
    if (FILE_EXT.test(href)) return;

    var isPreview = false;
    try {
      if (/^https?:\\/\\//i.test(href)) {
        var u = new URL(href);
        isPreview = u.origin === RENDER_ORIGIN
          && u.pathname.indexOf('/api/preview/help-center') !== -1;
      } else {
        isPreview = href.indexOf('/api/preview/help-center') !== -1;
      }
    } catch(_) {}

    if (isPreview) {
      e.preventDefault();
      e.stopPropagation();
      navTo(href);
    }
  }, true);
})();
<\/script>`;
}

function injectNavScript(html: string, navScript: string): string {
  if (html.includes('</body>')) {
    return html.replace('</body>', navScript + '</body>');
  }
  return html + navScript;
}

export async function openPreviewInNewWindow(previewUrl: string): Promise<void> {
  const win = window.open('', '_blank');
  if (!win) return;

  win.document.write(
    '<html><body style="font-family:sans-serif;padding:40px;color:#666"><p>加载中...</p></body></html>',
  );
  win.document.close();

  try {
    const html = await publishApi.getPreviewRenderedHtml(previewUrl);

    const renderBaseUrl = resolveAppUrl(`${PREVIEW_BASE}/render/`);
    const csrfToken = getCookieValue('suda-csrf-token');
    const urlObj = new URL(renderBaseUrl);
    const previewBasePath = urlObj.pathname.replace(/\/api\/preview\/help-center\/render\/?$/, '');
    const navScript = buildNavScript(renderBaseUrl, previewBasePath, csrfToken);

    (win as unknown as Record<string, unknown>).__previewNavScript = navScript;

    const injectedHtml = injectNavScript(html, navScript);
    win.document.open();
    win.document.write(injectedHtml);
    win.document.close();
  } catch {
    win.document.open();
    win.document.write(
      '<html><body style="font-family:sans-serif;padding:40px;color:#c00"><h3>预览加载失败</h3><p>请确认草稿预览已生成。</p></body></html>',
    );
    win.document.close();
  }
}
