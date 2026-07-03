// Shared pagination-control detection for DOM-category career pages.
//
// Two distinct pagination shapes show up in the wild:
//  1. Plain <a href="?skip=100">Next</a> — a static fetch can follow these
//     directly (findNextPageUrl).
//  2. AJAX/JS-driven controls with no href at all (e.g. a FacetWP-style
//     pager: <a class="facetwp-page next" data-page="2">›</a>, wired up by a
//     click handler) — these can only be found and followed on a page that
//     has actually run its JS, via a real browser (hasNextPageControl /
//     findClickableNextHandle).
//
// Some sites (e.g. Airbnb) go further: the pagination markup for shape 2
// doesn't exist anywhere in the raw static HTML — it's templated in from an
// embedded JSON config after JS runs. That means shape 2 can be invisible
// even to a static-HTML pass that's specifically looking for click-only
// controls with no href. detectCategory.js accounts for this by rendering
// once via Playwright at discovery time and checking there, not just in the
// raw fetch.
export const NEXT_PAGE_LINK_REGEX = /^(next|next page|»|›|>|→|load more|show more)$/i;

// This is a circuit breaker, not the real stopping condition — the fetchers
// stop following pagination as soon as a page contributes zero jobs not
// already seen (see STALE_PAGE_LIMIT), which is how "we've reached the last
// page" is actually detected. This cap only exists to bound worst-case time
// on a site whose pagination is broken/circular in a way that keeps
// producing "new" ids forever (e.g. a per-request random query param).
export const MAX_PAGES = 200;

// How many consecutive pages may contribute zero new jobs before the
// fetcher gives up on pagination. 1 would treat a single flaky/duplicate
// page (a click that didn't actually advance) as "the end" and stop early;
// in practice a click can occasionally misfire two times in a row against a
// live AJAX pager, so 3 gives enough headroom to ride that out without
// letting a genuinely broken/circular pager run away.
export const STALE_PAGE_LIMIT = 3;

export function findNextPageUrl($, baseUrl) {
  let found = null;
  $('a[href]').each((_, el) => {
    if (found) return;
    const text = $(el).text().trim();
    if (!NEXT_PAGE_LINK_REGEX.test(text)) return;
    const href = $(el).attr('href');
    if (!href || href === '#' || href.startsWith('javascript:')) return;
    try {
      found = new URL(href, baseUrl).toString();
    } catch {
      // ignore invalid href
    }
  });
  return found;
}

// True if the page has a "next"-shaped control at all, regardless of
// whether it carries a usable href. Used both to detect click-only controls
// (no href) and, at discovery time, to check whether a JS render surfaces
// pagination that was entirely absent from the raw static HTML.
export function hasNextPageControl($) {
  let found = false;
  $('a, button, [role="button"]').each((_, el) => {
    if (found) return;
    const $el = $(el);
    const text = $el.text().trim();
    const ariaLabel = ($el.attr('aria-label') || '').trim();
    if (!NEXT_PAGE_LINK_REGEX.test(text) && !NEXT_PAGE_LINK_REGEX.test(ariaLabel)) return;
    found = true;
  });
  return found;
}

// Same intent as hasNextPageControl, but only counts controls with no
// usable href — i.e. ones findNextPageUrl could never follow. Used by the
// static fetcher to decide whether to escalate to Playwright mid-run.
export function hasClickOnlyNextControl($) {
  let found = false;
  $('a, button, [role="button"]').each((_, el) => {
    if (found) return;
    const $el = $(el);
    const text = $el.text().trim();
    const ariaLabel = ($el.attr('aria-label') || '').trim();
    if (!NEXT_PAGE_LINK_REGEX.test(text) && !NEXT_PAGE_LINK_REGEX.test(ariaLabel)) return;
    const href = $el.attr('href');
    if (href && href !== '#' && !href.startsWith('javascript:')) return; // handled via href path
    found = true;
  });
  return found;
}

// Live-page equivalent, used inside a Playwright loop once href-based
// paging is exhausted. Returns a clickable ElementHandle for the first
// visible, enabled control that looks like "next", or null.
export async function findClickableNextHandle(page) {
  const candidates = await page.$$('a, button, [role="button"]');
  for (const el of candidates) {
    const text = (await el.innerText().catch(() => '')).trim();
    const ariaLabel = ((await el.getAttribute('aria-label').catch(() => '')) || '').trim();
    if (!NEXT_PAGE_LINK_REGEX.test(text) && !NEXT_PAGE_LINK_REGEX.test(ariaLabel)) continue;

    const disabled = await el.getAttribute('disabled').catch(() => null);
    const classAttr = ((await el.getAttribute('class').catch(() => '')) || '').toLowerCase();
    if (disabled != null || classAttr.includes('disabled')) continue;

    const visible = await el.isVisible().catch(() => false);
    if (!visible) continue;

    return el;
  }
  return null;
}
