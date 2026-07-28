// ==UserScript==
// @name         HDEncode Filter Suite
// @namespace    https://hdencode.org/
// @version      2.0
// @description  A Tampermonkey userscript that adds powerful filtering, searching and multi-page loading to HDEncode.org
// @author       mikeymuis
// @homepage     https://github.com/mikeymuis/hdencode-filter-suite
// @supportURL   https://github.com/mikeymuis/hdencode-filter-suite/issues
// @updateURL    https://raw.githubusercontent.com/mikeymuis/hdencode-filter-suite/main/hdencode-filter-suite.user.js
// @downloadURL  https://raw.githubusercontent.com/mikeymuis/hdencode-filter-suite/main/hdencode-filter-suite.user.js
// @match        *://hdencode.org/*
// @match        *://www.hdencode.org/*
// @match        *://hdencode.com/*
// @match        *://www.hdencode.com/*
// @match        *://hdencode.ro/*
// @match        *://www.hdencode.ro/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ─── Script constants ─────────────────────────────────────────────────────

    const SCRIPT_NAME    = 'HDEncode Filter Suite';
    const SCRIPT_VERSION = '2.0';
    const SCRIPT_ID      = 'hdencode-filter-suite';

    // ─── Helpers: item data extraction ───────────────────────────────────────

    function hasDV(item) {
        return !!item.querySelector('.dvbutton');
    }

    function hasHDR(item) {
        // .buttonhdr is a <style> tag — check via getElementsByClassName for reliability
        return item.getElementsByClassName('buttonhdr').length > 0;
    }

    function getRating(item) {
        const match = item.innerText.match(/Rating\s*:\s*(\d+\.\d+)\/10/i);
        return match ? parseFloat(match[1]) : 0;
    }

    function getSize(item) {
        const a = item.querySelector('h5 a');
        const title = a?.innerText || a?.textContent || '';
        const match = title.match(/–\s*(\d+(\.\d+)?)\s*GB/i);
        return match ? parseFloat(match[1]) : null;
    }

    function getGroup(item) {
        const a = item.querySelector('h5 a');
        const title = a?.innerText || a?.textContent || '';
        const clean = title.replace(/\s*–\s*[\d.]+\s*(GB|MB)\s*$/i, '').trim();
        const parts = clean.split('-');
        return parts.length > 1 ? parts.pop().trim() : '';
    }

    function getResolution(item) {
        for (const span of item.querySelectorAll('.calidad3')) {
            if (span.innerText.match(/\d{3,4}p/i)) return span.innerText.trim();
        }
        return '';
    }

    function getCategory(item) {
        // Check .calidad4 links for tv-shows and tv-packs
        // Items without .calidad4 are movies
        const links = Array.from(item.querySelectorAll('.calidad4 a'));
        const hrefs = links.map(a => a.href || a.getAttribute('href') || '');
        if (hrefs.some(h => h.includes('tv-packs'))) return 'tv-packs';
        if (hrefs.some(h => h.includes('tv-shows'))) return 'tv-shows';
        return 'movies';
    }

    // ─── Release group dropdown ───────────────────────────────────────────────

    function buildGroupDropdown(container) {
        const select = document.getElementById('f-group');
        if (!select) return;

        const current = select.value;

        // Track count and first-seen index per casing variant, keyed by lowercase
        // so e.g. "ETHEL" and "Ethel" are treated as the same group.
        // The variant with the highest count wins; ties go to the first one seen.
        const groupMap = new Map(); // lowercase key → { variants: Map<name, count>, firstSeen: number }
        let seen = 0;

        for (const item of container.querySelectorAll('.fit.item')) {
            if (item.style.display === 'none') continue;
            const g = getGroup(item);
            if (!g) continue;

            const key = g.toLowerCase();
            if (!groupMap.has(key)) {
                groupMap.set(key, { variants: new Map(), firstSeen: seen++ });
            }
            const entry = groupMap.get(key);
            entry.variants.set(g, (entry.variants.get(g) || 0) + 1);
        }

        // For each key, pick the variant with the highest count (first seen on tie)
        const groups = Array.from(groupMap.entries()).map(([key, entry]) => {
            let bestName = null;
            let bestCount = -1;
            for (const [name, count] of entry.variants) {
                if (count > bestCount) { bestName = name; bestCount = count; }
            }
            return { key, name: bestName };
        });

        groups.sort((a, b) => a.key.localeCompare(b.key));

        select.innerHTML = '<option value="">All groups</option>';
        for (const { key, name } of groups) {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = name;
            select.appendChild(opt);
        }

        if (current && Array.from(select.options).some(o => o.value === current)) {
            select.value = current;
        }
    }

    // ─── Filter logic ─────────────────────────────────────────────────────────

    function getFilterValues() {
        return {
            onlySDR:   document.getElementById('f-sdr')?.checked || false,
            onlyDV:    document.getElementById('f-dv')?.checked || false,
            onlyHDR:   document.getElementById('f-hdr')?.checked || false,
            res:       document.getElementById('f-res')?.value || '',
            category:  document.getElementById('f-category')?.value || '',
            minRating: parseFloat(document.getElementById('f-rating')?.value) || 0,
            minSize:   parseFloat(document.getElementById('f-minsize')?.value) || 0,
            maxSize:   parseFloat(document.getElementById('f-maxsize')?.value) || Infinity,
            group:     (document.getElementById('f-group')?.value || '').toLowerCase().trim(),
            search:    (document.getElementById('f-search')?.value || '').toLowerCase().trim(),
        };
    }

    function itemMatchesFilters(item, f) {
        if (f.onlySDR && (hasDV(item) || hasHDR(item))) return false;
        if (f.onlyDV && f.onlyHDR && !(hasDV(item) && hasHDR(item))) return false;
        if (f.onlyDV && !f.onlyHDR && !(hasDV(item) && !hasHDR(item))) return false;
        if (f.onlyHDR && !f.onlyDV && !(hasHDR(item) && !hasDV(item))) return false;
        if (f.res && getResolution(item) !== f.res) return false;
        if (f.category && getCategory(item) !== f.category) return false;
        if (getRating(item) < f.minRating) return false;
        const size = getSize(item);
        if (size !== null && (size < f.minSize || size > f.maxSize)) return false;
        if (f.group && getGroup(item).toLowerCase() !== f.group) return false;
        if (f.search && !item.innerText.toLowerCase().includes(f.search)) return false;
        return true;
    }

    function applyFilters(container) {
        const f = getFilterValues();
        const items = Array.from(container.querySelectorAll('.fit.item'));

        // Pass 1: filter without group — determines which items are visible for the dropdown
        for (const item of items) {
            item.style.display = itemMatchesFilters(item, { ...f, group: '' }) ? '' : 'none';
        }

        // Only rebuild the group dropdown when no group is selected —
        // otherwise the current selection disappears from the list.
        if (!f.group) buildGroupDropdown(container);


        let visible = 0;
        for (const item of items) {
            if (item.style.display === 'none') continue;
            if (f.group && getGroup(item).toLowerCase() !== f.group) {
                item.style.display = 'none';
            } else {
                visible++;
            }
        }

        const counter = document.getElementById('f-counter');
        if (!counter) return;

        if (visible === 0 && items.length > 0) {
            const hasActiveFilters =
                f.onlySDR || f.onlyDV || f.onlyHDR || f.res || f.category ||
                f.minRating > 0 || f.minSize > 0 || f.maxSize < Infinity ||
                f.group || f.search;

            counter.innerHTML = hasActiveFilters
                ? `<span style="color:#e06c75;">No results — try adjusting your filters</span>`
                : `Showing 0 / ${items.length} releases`;
        } else {
            counter.innerHTML = `Showing ${visible} / ${items.length} releases`;
        }

        for (const el of document.querySelectorAll(`#${SCRIPT_ID}-bar input, #${SCRIPT_ID}-bar select`)) {
            if (el.id === 'f-pagelimit') continue; // not a filter, don't highlight
            if (el.id.startsWith('fs-persist-')) continue; // settings checkboxes, don't highlight
            const active = el.type === 'checkbox' ? el.checked : el.value !== '';
            el.style.borderColor = active ? '#00e5ff' : 'rgba(255,255,255,0.15)';
        }

        saveFilters();
    }

    // ─── Settings (persistence preferences) ──────────────────────────────────

    // These are the filter IDs the user can choose to persist or not.
    // The key is the element ID, the value is a human-readable label.
    const PERSISTABLE_FILTERS = {
        'f-sdr':       'SDR',
        'f-dv':        'Dolby Vision',
        'f-hdr':       'HDR',
        'f-res':       'Resolution',
        'f-category':  'Content type',
        'f-rating':    'Minimum rating',
        'f-minsize':   'Min file size',
        'f-maxsize':   'Max file size',
        'f-group':     'Release group',
        'f-search':    'Search text',
        'f-pagelimit': 'Page limit',
    };

    function loadSettings() {
        try {
            return JSON.parse(localStorage.getItem('hdencodeSettings') || '{}');
        } catch (_) { return {}; }
    }

    function saveSettings(settings) {
        try { localStorage.setItem('hdencodeSettings', JSON.stringify(settings)); } catch (_) {}
    }

    function isFilterPersisted(id) {
        const settings = loadSettings();
        // f-pagelimit defaults to false (not persisted) unless explicitly enabled
        if (id === 'f-pagelimit') return settings['persist_' + id] === true;
        // All other filters default to true unless explicitly disabled
        return settings['persist_' + id] !== false;
    }

    // ─── LocalStorage ─────────────────────────────────────────────────────────

    function saveFilters() {
        const data = {};
        for (const el of document.querySelectorAll(`#${SCRIPT_ID}-bar input, #${SCRIPT_ID}-bar select`)) {
            if (el.id.startsWith('fs-persist-')) continue; // settings checkboxes, not filters
            if (!isFilterPersisted(el.id)) continue; // skip if user opted out
            data[el.id] = el.type === 'checkbox' ? el.checked : el.value;
        }
        try { localStorage.setItem('hdencodeFilters', JSON.stringify(data)); } catch (_) {}
    }

    function loadFilters() {
        try {
            const data = JSON.parse(localStorage.getItem('hdencodeFilters') || '{}');
            for (const [id, val] of Object.entries(data)) {
                if (id.startsWith('fs-persist-')) continue;
                if (!isFilterPersisted(id)) continue; // skip if user opted out
                const el = document.getElementById(id);
                if (!el) continue;
                if (el.type === 'checkbox') el.checked = val;
                else el.value = val;
            }
        } catch (_) {}
    }

    function syncDynamicRangeState() {
        const sdr = document.getElementById('f-sdr');
        const hdr = document.getElementById('f-hdr');
        const dv  = document.getElementById('f-dv');
        if (!sdr || !hdr || !dv) return;

        if (sdr.checked) {
            hdr.checked  = false;
            dv.checked   = false;
            hdr.disabled = true;
            dv.disabled  = true;
            hdr.parentElement.style.opacity = '0.4';
            dv.parentElement.style.opacity  = '0.4';
            hdr.parentElement.style.cursor  = 'not-allowed';
            dv.parentElement.style.cursor   = 'not-allowed';
            hdr.title = 'Disabled when SDR is active';
            dv.title  = 'Disabled when SDR is active';
        } else {
            hdr.disabled = false;
            dv.disabled  = false;
            hdr.parentElement.style.opacity = '';
            dv.parentElement.style.opacity  = '';
            hdr.parentElement.style.cursor  = '';
            dv.parentElement.style.cursor   = '';
            hdr.title = '';
            dv.title  = '';
        }
    }

    function clearFilters(container) {
        for (const el of document.querySelectorAll(`#${SCRIPT_ID}-bar input, #${SCRIPT_ID}-bar select`)) {
            if (el.id.startsWith('fs-persist-')) continue; // never touch settings checkboxes
            else if (el.id === 'f-pagelimit' && !isFilterPersisted('f-pagelimit')) el.value = 'all';
            else if (el.id === 'f-pagelimit') continue; // user chose to persist it, leave it alone
            else if (el.type === 'checkbox') el.checked = false;
            else el.value = '';
        }
        try { localStorage.removeItem('hdencodeFilters'); } catch (_) {}
        syncDynamicRangeState();
        applyFilters(container);
    }

    // ─── Quick links & NFO ────────────────────────────────────────────────────

    const linkCache = new Map();
    const nfoCache  = new Map();

    async function fetchDetailData(url) {
        // Returns { links, nfo } — both cached separately so either can be used independently.
        // We only fetch the detail page once; the NFO comes from the first GET,
        // the links come from the POST response.

        const linksAlready = linkCache.has(url);
        const nfoAlready   = nfoCache.has(url);
        if (linksAlready && nfoAlready) {
            return { links: linkCache.get(url), nfo: nfoCache.get(url) };
        }

        try {
            // Step 1: GET the detail page
            const getRes = await fetch(url, { credentials: 'same-origin' });
            if (!getRes.ok) return { links: null, nfo: null };

            const doc = new DOMParser().parseFromString(await getRes.text(), 'text/html');

            // Extract NFO from the single <pre> in .entry-content
            const nfoText = doc.querySelector('.entry-content pre')?.innerText
                         || doc.querySelector('.entry-content pre')?.textContent
                         || null;
            nfoCache.set(url, nfoText);

            // Step 2: Find the content protector form
            const form = doc.querySelector('form[id^="content-protector-access-form"]');
            if (!form) {
                linkCache.set(url, []);
                return { links: [], nfo: nfoText };
            }

            const formData = new FormData();
            for (const input of form.querySelectorAll('input')) {
                if (input.name) formData.append(input.name, input.value);
            }

            // Step 3: POST the form to unlock the links
            const action = new URL(form.getAttribute('action'), url).href;
            const postRes = await fetch(action, {
                method: 'POST',
                credentials: 'same-origin',
                body: formData,
            });
            if (!postRes.ok) {
                linkCache.set(url, []);
                return { links: [], nfo: nfoText };
            }

            const unlockedDoc = new DOMParser().parseFromString(await postRes.text(), 'text/html');

            // Step 4: Extract links
            const HOST_NAMES = {
                'rg': 'Rapidgator', 'rapidgator': 'Rapidgator',
                'nf': 'Nitroflare', 'nitroflare': 'Nitroflare',
                'ddl': 'DDL', 'mega': 'Mega', '1fichier': '1Fichier',
                'ul': 'Uploadgig', 'uploadgig': 'Uploadgig',
                'katfile': 'Katfile', 'filefox': 'Filefox',
            };
            const links = [];
            for (const blockquote of unlockedDoc.querySelectorAll('.content-protector-access-form blockquote')) {
                const img = blockquote.previousElementSibling?.querySelector('img');
                const raw = (img?.alt || img?.src?.split('/').pop().replace(/\.(png|jpg|gif)$/i, '') || 'Link').toLowerCase().trim();
                const host = HOST_NAMES[raw] || raw.charAt(0).toUpperCase() + raw.slice(1);
                for (const a of blockquote.querySelectorAll('a')) {
                    links.push({ host, url: a.href });
                }
            }

            linkCache.set(url, links);
            return { links, nfo: nfoText };
        } catch (e) {
            console.error(`${SCRIPT_NAME}: failed to fetch detail data for`, url, e);
            return { links: null, nfo: null };
        }
    }

    // Keep fetchLinks as a thin wrapper so nothing else breaks
    async function fetchLinks(url) {
        const { links } = await fetchDetailData(url);
        return links;
    }

    // Shared helper: attach copy-to-clipboard handlers to all .fs-copy-btn inside a panel
    function attachCopyHandlers(panel) {
        panel.querySelectorAll('.fs-copy-btn').forEach(copyBtn => {
            copyBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const original = copyBtn.textContent;
                try {
                    await navigator.clipboard.writeText(copyBtn.dataset.url);
                    copyBtn.textContent = '✓';
                    copyBtn.style.color = '#00e5ff';
                    copyBtn.style.borderColor = '#00e5ff';
                    setTimeout(() => {
                        copyBtn.textContent = original;
                        copyBtn.style.color = '#8b949e';
                        copyBtn.style.borderColor = '#30363d';
                    }, 1500);
                } catch (_) {
                    copyBtn.textContent = '✗';
                    setTimeout(() => { copyBtn.textContent = original; }, 1500);
                }
            });
        });
    }

    function makeBtn(label, color, borderColor) {
        const btn = document.createElement('span');
        btn.innerHTML = label;
        Object.assign(btn.style, {
            cursor: 'pointer',
            marginLeft: '8px',
            fontSize: '11px',
            color,
            border: `1px solid ${borderColor}`,
            borderRadius: '4px',
            padding: '1px 7px',
            background: 'transparent',
            userSelect: 'none',
            verticalAlign: 'middle',
            whiteSpace: 'nowrap',
            flexShrink: '0',
        });
        return btn;
    }

    function makePanel() {
        const panel = document.createElement('div');
        Object.assign(panel.style, {
            display: 'none',
            marginTop: '6px',
            padding: '8px 10px',
            background: '#161b22',
            border: '1px solid #21262d',
            borderRadius: '6px',
            fontSize: '12px',
            lineHeight: '1.8',
        });
        return panel;
    }

    function injectLinkButton(item) {
        if (item.querySelector('.fs-link-btn')) return;

        const h5 = item.querySelector('h5');
        if (!h5) return;

        const detailUrl = h5.querySelector('a')?.href;
        if (!detailUrl) return;

        // ── Links button — opens detail page in new tab ───────────────────────
        // HDEncode now protects links with Cloudflare Turnstile + ALTCHA,
        // which require JavaScript execution and cannot be solved via fetch.
        // Opening the detail page directly is the most reliable approach.
        const linkBtn = makeBtn('🔗 Links', '#00e5ff', 'rgba(0,229,255,0.35)');
        linkBtn.className = 'fs-link-btn';
        linkBtn.title = 'Open detail page to view download links';

        linkBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.open(detailUrl, '_blank');
        });

        linkBtn.addEventListener('mouseover', () => { linkBtn.style.background = 'rgba(0,229,255,0.08)'; });
        linkBtn.addEventListener('mouseout',  () => { linkBtn.style.background = 'transparent'; });

        // ── NFO button ────────────────────────────────────────────────────────
        const nfoBtn = makeBtn('📄 NFO', '#a8b8c8', 'rgba(168,184,200,0.35)');
        nfoBtn.className = 'fs-nfo-btn';
        nfoBtn.title = 'Show NFO / media info';

        const nfoPanel = makePanel();
        nfoPanel.className = 'fs-nfo-panel';

        let nfoOpen = false;

        nfoBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (nfoOpen) {
                nfoPanel.style.display = 'none';
                nfoBtn.style.opacity = '0.6';
                nfoOpen = false;
                return;
            }

            nfoBtn.innerHTML = '⏳';
            nfoBtn.style.opacity = '1';

            let nfoText = null;

            // Check cache first
            if (nfoCache.has(detailUrl)) {
                nfoText = nfoCache.get(detailUrl);
            } else {
                try {
                    const res = await fetch(detailUrl, { credentials: 'same-origin' });
                    if (res.ok) {
                        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');

                        // New markup: .minfo-body with structured divs
                        const minfoBody = doc.querySelector('.minfo-body');
                        if (minfoBody) {
                            // Extract rows as "Key: Value" lines
                            const lines = [];
                            const header = minfoBody.querySelector('.minfo-header');
                            if (header) lines.push(header.textContent.trim(), '');

                            for (const section of minfoBody.querySelectorAll('.minfo-section-title')) {
                                lines.push('', section.textContent.trim());
                                const table = section.nextElementSibling;
                                if (table) {
                                    for (const row of table.querySelectorAll('.minfo-row')) {
                                        const key = row.querySelector('.minfo-key')?.textContent.trim() || '';
                                        const val = row.querySelector('.minfo-value')?.textContent.trim() || '';
                                        if (key) lines.push(`${key.padEnd(12)}: ${val}`);
                                    }
                                }
                            }

                            // Subtitles
                            const subs = [...minfoBody.querySelectorAll('.minfo-sub')].map(s => s.textContent.trim());
                            if (subs.length) {
                                lines.push('', 'Subtitles');
                                subs.forEach(s => lines.push(`  ${s}`));
                            }

                            nfoText = lines.join('\n');
                        } else {
                            // Fallback: old <pre> markup
                            nfoText = doc.querySelector('.entry-content pre')?.textContent || null;
                        }

                        nfoCache.set(detailUrl, nfoText);
                    }
                } catch (e) {
                    console.error(`${SCRIPT_NAME}: NFO fetch failed`, e);
                }
            }

            if (!nfoText || !nfoText.trim()) {
                nfoPanel.innerHTML = '<span style="color:#8b949e;">No NFO found.</span>';
            } else {
                const escaped = nfoText
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');

                nfoPanel.innerHTML = `
                    <pre style="
                        margin: 0;
                        font-family: 'Consolas', 'Courier New', monospace;
                        font-size: 11px;
                        line-height: 1.6;
                        color: #c9d1d9;
                        white-space: pre-wrap;
                        word-break: break-word;
                        max-height: 400px;
                        overflow-y: auto;
                    ">${escaped}</pre>`;
            }

            nfoBtn.innerHTML = '📄 NFO';
            nfoPanel.style.display = 'block';
            nfoOpen = true;
        });

        nfoBtn.addEventListener('mouseover', () => { if (!nfoOpen) nfoBtn.style.background = 'rgba(168,184,200,0.08)'; });
        nfoBtn.addEventListener('mouseout',  () => { if (!nfoOpen) nfoBtn.style.background = 'transparent'; });

        // ── Inject into DOM ───────────────────────────────────────────────────
        h5.appendChild(linkBtn);
        h5.appendChild(nfoBtn);

        h5.after(nfoPanel);
    }

    function injectLinkButtons(container) {
        for (const item of container.querySelectorAll('.fit.item')) {
            injectLinkButton(item);
        }
    }



    const INPUT_STYLE = `
        background: #161b22;
        color: #e6edf3;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 6px;
        padding: 5px 8px;
        font-size: 13px;
        outline: none;
        transition: border-color 0.2s;
        height: 30px;
        box-sizing: border-box;
    `;

    // Consistent width for all number inputs
    const NUMBER_W = 'width:88px;';

    function createBar() {
        const bar = document.createElement('div');
        bar.id = `${SCRIPT_ID}-bar`;
        Object.assign(bar.style, {
            background:   '#0d1117',
            padding:      '14px 18px',
            borderRadius: '12px',
            border:       '1px solid #21262d',
            margin:       '16px 0',
            color:        '#e6edf3',
            fontSize:     '13px',
            boxShadow:    '0 4px 20px rgba(0,0,0,0.4)',
        });

        bar.innerHTML = `
            <!-- Header row: title + counter + gear -->
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
                <strong style="color:#00e5ff; font-size:14px; letter-spacing:0.5px;">⚡ ${SCRIPT_NAME}</strong>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span id="f-counter" style="color:#8b949e; font-size:12px;"></span>
                    <span id="f-settings-toggle" title="Advanced settings"
                        style="cursor:pointer; color:#8b949e; font-size:14px; user-select:none;
                               padding:2px 5px; border-radius:4px; transition:color 0.2s;"
                        onmouseover="this.style.color='#e6edf3'"
                        onmouseout="this.style.color='#8b949e'">⚙️</span>
                </div>
            </div>

            <!-- Settings panel: hidden by default -->
            <div id="f-settings-panel" style="display:none; margin-bottom:10px; padding:10px 12px;
                background:#161b22; border:1px solid #21262d; border-radius:8px;">
                <div style="color:#8b949e; font-size:11px; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px;">
                    Saved filters — uncheck to stop saving a filter between visits
                </div>
                <div style="display:flex; flex-wrap:wrap; gap:6px 16px;">
                    ${Object.entries(PERSISTABLE_FILTERS).map(([id, label]) => `
                        <label style="display:flex; align-items:center; gap:4px; cursor:pointer; font-size:12px; color:#c9d1d9; white-space:nowrap;">
                            <input type="checkbox" id="fs-persist-${id}" checked style="accent-color:#00e5ff;">
                            <span>${label}</span>
                        </label>
                    `).join('')}
                </div>
            </div>

            <!-- Row 1: quality filters left, category right -->
            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-bottom:8px;">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <label style="display:flex; align-items:center; gap:4px; cursor:pointer; white-space:nowrap;">
                        <input type="checkbox" id="f-sdr" style="accent-color:#00e5ff;">
                        <span>SDR</span>
                    </label>
                    <div style="width:1px; height:16px; background:#30363d;"></div>
                    <label style="display:flex; align-items:center; gap:4px; cursor:pointer; white-space:nowrap;" id="f-dv-label">
                        <input type="checkbox" id="f-dv" style="accent-color:#00e5ff;">
                        <span>Dolby Vision</span>
                    </label>
                    <label style="display:flex; align-items:center; gap:4px; cursor:pointer;" id="f-hdr-label">
                        <input type="checkbox" id="f-hdr" style="accent-color:#00e5ff;">
                        <span>HDR</span>
                    </label>

                    <select id="f-res" style="${INPUT_STYLE} width:130px;">
                        <option value="">All resolutions</option>
                        <option value="2160p">2160p</option>
                        <option value="1080p">1080p</option>
                        <option value="720p">720p</option>
                    </select>

                    <input type="number" id="f-rating" placeholder="Min rating" step="0.1" min="0" max="10"
                        style="${INPUT_STYLE} ${NUMBER_W}">
                    <input type="number" id="f-minsize" placeholder="Min GB" min="0"
                        style="${INPUT_STYLE} ${NUMBER_W}">
                    <input type="number" id="f-maxsize" placeholder="Max GB" min="0"
                        style="${INPUT_STYLE} ${NUMBER_W}">
                </div>

                <!-- Category: right-aligned but visually part of row 1 -->
                <select id="f-category" style="${INPUT_STYLE} width:110px;">
                    <option value="">All</option>
                    <option value="movies">Movies</option>
                    <option value="tv-shows">TV Shows</option>
                    <option value="tv-packs">TV Packs</option>
                </select>
            </div>

            <!-- Subtle divider between rows -->
            <div style="border-top: 1px solid #21262d; margin-bottom:8px;"></div>

            <!-- Row 2: search & group left, load controls + clear right -->
            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                    <select id="f-group" style="${INPUT_STYLE} width:150px;">
                        <option value="">All groups</option>
                    </select>
                    <input type="text" id="f-search" placeholder="Search anything..."
                        style="${INPUT_STYLE} width:180px;">
                </div>

                <div style="display:flex; align-items:center; gap:8px;">
                    <span id="f-load-status" style="color:#8b949e; font-size:12px;"></span>

                    <select id="f-pagelimit" style="${INPUT_STYLE} width:100px;">
                        <option value="all">All pages</option>
                        <option value="5">5 pages</option>
                        <option value="10">10 pages</option>
                        <option value="20">20 pages</option>
                        <option value="50">50 pages</option>
                        <option value="100">100 pages</option>
                    </select>

                    <button id="f-loadall"
                        style="background:#21262d; color:#e6edf3;
                               border:1px solid rgba(0,229,255,0.25);
                               border-radius:6px; padding:5px 12px; cursor:pointer; font-size:13px;
                               height:30px; box-sizing:border-box; transition: all 0.2s;">
                        ↓ Load pages
                    </button>

                    <button id="f-stop"
                        style="display:none; background:transparent; color:#f59e0b;
                               border:1px solid rgba(245,158,11,0.35);
                               border-radius:6px; padding:5px 12px; cursor:pointer; font-size:13px;
                               height:30px; box-sizing:border-box; transition: all 0.2s;">
                        ⏹ Stop
                    </button>

                    <!-- Subtle separator -->
                    <div style="width:1px; height:20px; background:#30363d;"></div>

                    <button id="f-clear"
                        style="background:transparent; color:#e06c75;
                               border:1px solid rgba(224,108,117,0.35);
                               border-radius:6px; padding:5px 12px; cursor:pointer; font-size:13px;
                               height:30px; box-sizing:border-box; transition: all 0.2s;">
                        ✕ Clear
                    </button>
                </div>
            </div>

            <!-- Progress bar: hidden until loading starts -->
            <div id="f-progress-wrap" style="display:none; margin-top:10px;">
                <div style="background:#21262d; border-radius:999px; height:5px; overflow:hidden;">
                    <div id="f-progress-bar"
                        style="height:100%; width:0%; background:#00e5ff;
                               border-radius:999px; transition: width 0.3s ease;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; margin-top:5px;">
                    <span id="f-progress-label" style="color:#8b949e; font-size:12px;"></span>
                    <span id="f-progress-pct" style="color:#8b949e; font-size:12px;"></span>
                </div>
            </div>

            <!-- Recommended use hint: only shown on pages without a clear category context -->
            <div id="f-recommended-hint" style="display:none; margin-top:8px; color:#8b949e; font-size:11px;">
                💡 For best results, search or browse a category first before loading pages.
            </div>
        `;

        bar.addEventListener('mouseover', e => {
            if (e.target.id === 'f-loadall') {
                e.target.style.background = '#30363d';
                e.target.style.borderColor = 'rgba(0,229,255,0.5)';
            }
            if (e.target.id === 'f-clear') {
                e.target.style.background = 'rgba(224,108,117,0.12)';
                e.target.style.borderColor = 'rgba(224,108,117,0.6)';
            }
            if (e.target.id === 'f-stop') {
                e.target.style.background = 'rgba(245,158,11,0.12)';
                e.target.style.borderColor = 'rgba(245,158,11,0.6)';
            }
        });
        bar.addEventListener('mouseout', e => {
            if (e.target.id === 'f-loadall') {
                e.target.style.background = '#21262d';
                e.target.style.borderColor = 'rgba(0,229,255,0.25)';
            }
            if (e.target.id === 'f-clear') {
                e.target.style.background = 'transparent';
                e.target.style.borderColor = 'rgba(224,108,117,0.35)';
            }
            if (e.target.id === 'f-stop') {
                e.target.style.background = 'transparent';
                e.target.style.borderColor = 'rgba(245,158,11,0.35)';
            }
        });

        return bar;
    }

    // ─── Progress bar ─────────────────────────────────────────────────────────

    function showProgress() {
        document.getElementById('f-progress-wrap').style.display = 'block';
    }

    function updateProgress(loaded, total) {
        const pct = Math.round((loaded / total) * 100);
        document.getElementById('f-progress-bar').style.width = `${pct}%`;
        document.getElementById('f-progress-label').textContent = `Page ${loaded + 1} of ${total}`;
        document.getElementById('f-progress-pct').textContent = `${pct}%`;
    }

    function hideProgress() {
        // Fill bar to 100% then hide after a short pause
        document.getElementById('f-progress-bar').style.width = '100%';
        document.getElementById('f-progress-pct').textContent = '100%';
        document.getElementById('f-progress-label').textContent = 'Done!';
        setTimeout(() => {
            document.getElementById('f-progress-wrap').style.display = 'none';
            document.getElementById('f-progress-bar').style.width = '0%';
        }, 1500);
    }

    // ─── Load pages ───────────────────────────────────────────────────────────

    let currentAbortController = null;

    function updateRecommendedHint() {
        const hint = document.getElementById('f-recommended-hint');
        if (!hint) return;
        const path = window.location.pathname;
        const onCategory = /\/(tag\/|quality\/|top-downloads)/.test(path);
        const hasSearch = !!new URL(window.location.href).searchParams.get('s');
        hint.style.display = (onCategory || hasSearch) ? 'none' : 'block';
    }

    async function loadAllPages(container, statusEl) {
        const itemGrid = container.querySelector('.item_2.items') || container;
        const currentUrl = new URL(window.location.href);

        const limitVal = document.getElementById('f-pagelimit')?.value || 'all';
        const limit = limitVal === 'all' ? 99999 : parseInt(limitVal);

        const loadBtn = document.getElementById('f-loadall');
        const stopBtn = document.getElementById('f-stop');

        currentAbortController = new AbortController();
        const { signal } = currentAbortController;

        if (stopBtn) stopBtn.style.display = 'inline-block';

        showProgress();
        updateProgress(0, limit === 99999 ? 1 : limit);

        let loaded = 0;
        try {
            for (let p = 2; loaded < limit; p++) {
                if (signal.aborted) break;

                const url = currentUrl.pathname.match(/\/page\/\d+\//)
                    ? window.location.href.replace(/\/page\/\d+\//, `/page/${p}/`)
                    : currentUrl.origin + currentUrl.pathname.replace(/\/$/, '') + `/page/${p}/` + currentUrl.search;

                try {
                    const res = await fetch(url, { credentials: 'same-origin', signal });
                    if (!res.ok) break;

                    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
                    const sourceGrid = doc.querySelector('.item_2.items') || doc;
                    sourceGrid.querySelector('#paginador')?.remove();

                    const fetchedItems = sourceGrid.querySelectorAll('.fit.item');
                    if (!fetchedItems.length) break;

                    const fragment = document.createDocumentFragment();
                    for (const node of fetchedItems) {
                        const clone = document.importNode(node, true);
                        clone.removeAttribute('style');
                        fragment.appendChild(clone);
                    }
                    itemGrid.appendChild(fragment);

                    loaded++;
                    if (limit !== 99999) updateProgress(loaded, limit);
                    else {
                        document.getElementById('f-progress-bar').style.width = '100%';
                        document.getElementById('f-progress-label').textContent = `${loaded} page(s) loaded...`;
                        document.getElementById('f-progress-pct').textContent = '';
                    }
                    await new Promise(r => setTimeout(r, 300));
                } catch (e) {
                    if (e.name === 'AbortError') break;
                    console.error(`${SCRIPT_NAME}: fetch failed for`, url, e);
                    break;
                }
            }
        } finally {
            currentAbortController = null;
            if (stopBtn) stopBtn.style.display = 'none';
            if (loadBtn) loadBtn.disabled = false;
        }

        hideProgress();
        statusEl.textContent = `${loaded} page(s) loaded`;
        setTimeout(() => statusEl.textContent = '', 5000);
    }

    // ─── Init ─────────────────────────────────────────────────────────────────

    function init(container) {
        if (document.getElementById(`${SCRIPT_ID}-bar`)) return;

        const bar = createBar();
        try {
            container.parentNode.insertBefore(bar, container);
        } catch (_) {
            document.body.insertBefore(bar, document.body.firstChild);
        }

        bar.querySelector('#f-clear').addEventListener('click', () => clearFilters(container));

        // ── Settings panel toggle ────────────────────────────────────────────
        const settingsToggle = bar.querySelector('#f-settings-toggle');
        const settingsPanel  = bar.querySelector('#f-settings-panel');

        // Load saved persistence preferences into the checkboxes
        const savedSettings = loadSettings();
        for (const id of Object.keys(PERSISTABLE_FILTERS)) {
            const cb = document.getElementById(`fs-persist-${id}`);
            if (!cb) continue;
            if (id === 'f-pagelimit') {
                cb.checked = savedSettings['persist_' + id] === true; // default false
            } else {
                cb.checked = savedSettings['persist_' + id] !== false; // default true
            }
        }

        settingsToggle.addEventListener('click', () => {
            const open = settingsPanel.style.display !== 'none';
            settingsPanel.style.display = open ? 'none' : 'block';
            settingsToggle.style.color = open ? '#8b949e' : '#00e5ff';
        });

        // Save persistence preference whenever a settings checkbox changes
        for (const id of Object.keys(PERSISTABLE_FILTERS)) {
            const cb = document.getElementById(`fs-persist-${id}`);
            if (!cb) continue;
            cb.addEventListener('change', () => {
                const settings = loadSettings();
                settings['persist_' + id] = cb.checked;
                saveSettings(settings);
            });
        }

        bar.querySelector('#f-stop').addEventListener('click', () => {
            if (currentAbortController) currentAbortController.abort();
        });

        bar.querySelector('#f-loadall').addEventListener('click', async function () {
            this.disabled = true;
            const status = document.getElementById('f-load-status');

            // Hide the existing page pagination — no longer relevant once we load extra pages
            document.querySelector('#paginador')?.style.setProperty('display', 'none');

            try {
                await loadAllPages(container, status);
                buildGroupDropdown(container);
                applyFilters(container);
            } catch (e) {
                console.error(`${SCRIPT_NAME}: load pages error`, e);
                status.textContent = 'Error loading pages';
            } finally {
                this.disabled = false;
            }
        });

        const sdrEl = document.getElementById('f-sdr');
        if (sdrEl) {
            sdrEl.addEventListener('change', () => {
                syncDynamicRangeState();
                applyFilters(container);
            });
        }

        for (const el of bar.querySelectorAll('input, select')) {
            el.addEventListener('input', () => applyFilters(container));
        }

        buildGroupDropdown(container);
        loadFilters();
        syncDynamicRangeState();
        applyFilters(container);
        injectLinkButtons(container);
        updateRecommendedHint();

        let debounceTimer;
        new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                applyFilters(container);
                injectLinkButtons(container);
            }, 150);
        }).observe(container, { childList: true, subtree: true });
    }

    // ─── Detail page: auto-click View links + copy links to top ──────────────

    function isDetailPage() {
        return !!document.querySelector('#single .entry-content');
    }

    function initDetailPage() {
        const settings = loadDetailSettings();

        // If scroll is off, immediately counter the browser's anchor scroll to #unlocked
        if ((settings.scrollTarget || 'panel') === 'off') {
            window.scrollTo({ top: 0, behavior: 'instant' });
            setTimeout(() => window.scrollTo({ top: 0, behavior: 'instant' }), 100);
            setTimeout(() => window.scrollTo({ top: 0, behavior: 'instant' }), 500);
        }

        // Check if links are already visible (no form/button needed)
        const existingBlockquotes = document.querySelectorAll('.content-protector-access-form blockquote');
        if (existingBlockquotes.length) {
            waitForLinksAndInject();
            return;
        }

        // Otherwise wait for the content protector form and auto-click
        const form = document.querySelector('form[id^="content-protector-access-form"]');
        const submitBtn = form?.querySelector('input[type="submit"]');
        if (!form || !submitBtn) return;

        // Poll until the button is enabled (Turnstile + ALTCHA done)
        const poll = setInterval(() => {
            const btn = form.querySelector('input[type="submit"]');
            if (!btn || btn.disabled) return;

            clearInterval(poll);

            // Auto-click the button
            btn.click();

            // After click, wait for links to appear and inject copy buttons
            waitForLinksAndInject();
        }, 300);
    }

    function showToast(message) {
        const existing = document.getElementById('fs-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'fs-toast';
        toast.textContent = message;
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '32px',
            right: '32px',
            background: '#0d1117',
            color: '#00e5ff',
            border: '2px solid rgba(0,229,255,0.6)',
            borderRadius: '10px',
            padding: '14px 22px',
            fontSize: '15px',
            fontWeight: '600',
            fontFamily: 'sans-serif',
            zIndex: '999999',
            boxShadow: '0 6px 24px rgba(0,229,255,0.15), 0 2px 8px rgba(0,0,0,0.6)',
            opacity: '0',
            transform: 'translateY(10px)',
            transition: 'opacity 0.2s ease, transform 0.2s ease',
            pointerEvents: 'none',
            letterSpacing: '0.2px',
        });

        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 200);
        }, 2500);
    }

    function loadDetailSettings() {
        try { return JSON.parse(localStorage.getItem('hdencodeDetailSettings') || '{}'); }
        catch (_) { return {}; }
    }

    function saveDetailSettings(s) {
        try { localStorage.setItem('hdencodeDetailSettings', JSON.stringify(s)); } catch (_) {}
    }

    function waitForLinksAndInject() {
        let attempts = 0;
        const check = setInterval(() => {
            attempts++;
            if (attempts > 60) { clearInterval(check); return; }

            const blockquotes = document.querySelectorAll('.content-protector-access-form blockquote');
            if (!blockquotes.length) return;

            clearInterval(check);

            const HOST_COLORS = {
                'rapidgator': '#00b4d8', 'rg': '#00b4d8',
                'nitroflare': '#f59e0b', 'nf': '#f59e0b',
                'mega': '#e74c3c', '1fichier': '#8b5cf6',
                'uploadgig': '#22c55e', 'ul': '#22c55e',
                'katfile': '#ec4899', 'filefox': '#f97316',
            };
            const HOST_NAMES = {
                'rg': 'Rapidgator', 'rapidgator': 'Rapidgator',
                'nf': 'Nitroflare', 'nitroflare': 'Nitroflare',
                'mega': 'Mega', '1fichier': '1Fichier',
                'ul': 'Uploadgig', 'uploadgig': 'Uploadgig',
                'katfile': 'Katfile', 'filefox': 'Filefox',
            };

            const grouped = {};
            for (const bq of blockquotes) {
                const img = bq.previousElementSibling?.querySelector('img');
                const raw = (img?.alt || img?.src?.split('/').pop().replace(/\.(png|jpg|gif)$/i, '') || 'Link').toLowerCase().trim();
                const host = HOST_NAMES[raw] || raw.charAt(0).toUpperCase() + raw.slice(1);
                const color = HOST_COLORS[raw] || '#8b949e';
                if (!grouped[host]) grouped[host] = { color, urls: [] };
                for (const a of bq.querySelectorAll('a')) grouped[host].urls.push(a.href);
            }

            if (!Object.keys(grouped).length) return;

            const settings   = loadDetailSettings();
            const scrollTo   = settings.scrollTarget  || 'panel';
            const autoCopy   = settings.autoCopyHost  || '';
            const hostOptions = Object.keys(grouped);

            // ── Settings sub-panel ────────────────────────────────────────────
            const settingsPanel = document.createElement('div');
            settingsPanel.id = 'fs-detail-settings';
            Object.assign(settingsPanel.style, {
                display: 'none',
                marginTop: '10px',
                padding: '10px 12px',
                background: '#161b22',
                border: '1px solid #21262d',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#c9d1d9',
            });
            settingsPanel.innerHTML = `
                <div style="display:flex; flex-wrap:wrap; gap:12px 24px; align-items:flex-start;">
                    <div>
                        <div style="color:#8b949e; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">Scroll to</div>
                        <label style="display:flex; align-items:center; gap:4px; cursor:pointer; margin-bottom:4px;">
                            <input type="radio" name="fs-scroll" value="panel" ${scrollTo === 'panel' ? 'checked' : ''} style="accent-color:#00e5ff;">
                            <span>Our panel (top)</span>
                        </label>
                        <label style="display:flex; align-items:center; gap:4px; cursor:pointer; margin-bottom:4px;">
                            <input type="radio" name="fs-scroll" value="links" ${scrollTo === 'links' ? 'checked' : ''} style="accent-color:#00e5ff;">
                            <span>Download links (bottom)</span>
                        </label>
                        <label style="display:flex; align-items:center; gap:4px; cursor:pointer;">
                            <input type="radio" name="fs-scroll" value="off" ${scrollTo === 'off' ? 'checked' : ''} style="accent-color:#00e5ff;">
                            <span>Off</span>
                        </label>
                    </div>
                    <div>
                        <div style="color:#8b949e; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">Auto-copy on load</div>
                        <select id="fs-autocopy-select" style="background:#0d1117; color:#e6edf3; border:1px solid #30363d; border-radius:5px; padding:4px 8px; font-size:12px;">
                            <option value="">Off</option>
                            ${hostOptions.map(h => `<option value="${h}" ${autoCopy === h ? 'selected' : ''}>${h}</option>`).join('')}
                        </select>
                    </div>
                </div>`;

            // ── Main panel ────────────────────────────────────────────────────
            const panel = document.createElement('div');
            panel.id = 'fs-detail-links-panel';
            Object.assign(panel.style, {
                background: '#0d1117',
                border: '1px solid #21262d',
                borderRadius: '10px',
                padding: '14px 16px',
                marginBottom: '16px',
                fontFamily: 'sans-serif',
                fontSize: '13px',
                color: '#e6edf3',
            });

            panel.innerHTML = `
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
                    <div style="color:#00e5ff; font-weight:600; font-size:13px; letter-spacing:0.3px;">⚡ Download Links</div>
                    <button id="fs-detail-gear" title="Settings" style="cursor:pointer; color:#c9d1d9; font-size:12px; user-select:none; padding:3px 10px; border-radius:5px; background:#21262d; border:1px solid #444c56;">⚙️ Settings</button>
                </div>
                ${Object.entries(grouped).map(([host, { color, urls }]) => `
                    <div style="margin-bottom:10px;">
                        <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${color};"></span>
                            <span style="color:#8b949e; text-transform:uppercase; font-size:10px; letter-spacing:0.5px; font-weight:600;">${host}</span>
                            <span class="fs-copy-all" data-urls="${urls.join('\n')}"
                                style="cursor:pointer; font-size:10px; color:#8b949e; padding:1px 6px;
                                       border:1px solid #30363d; border-radius:4px; user-select:none;"
                                onmouseover="this.style.color='#e6edf3'" onmouseout="this.style.color='#8b949e'">
                                📋 Copy all
                            </span>
                        </div>
                        ${urls.map(u => `
                            <div style="display:flex; align-items:center; gap:6px; margin:3px 0;">
                                <a href="${u}" target="_blank"
                                    style="color:#00e5ff; text-decoration:none; word-break:break-all; font-size:12px;"
                                    onmouseover="this.style.textDecoration='underline'"
                                    onmouseout="this.style.textDecoration='none'">${u}</a>
                                <span class="fs-copy-one" data-url="${u}"
                                    style="cursor:pointer; font-size:11px; color:#8b949e; padding:1px 5px;
                                           border:1px solid #30363d; border-radius:4px; user-select:none; flex-shrink:0;"
                                    onmouseover="this.style.color='#e6edf3'" onmouseout="this.style.color='#8b949e'">📋</span>
                            </div>`).join('')}
                    </div>`).join('')}`;

            panel.appendChild(settingsPanel);

            // Copy handlers in panel
            panel.querySelectorAll('.fs-copy-all').forEach(btn => {
                btn.addEventListener('click', async () => {
                    await navigator.clipboard.writeText(btn.dataset.urls);
                    const orig = btn.textContent.trim();
                    btn.textContent = '✓ Copied'; btn.style.color = '#00e5ff';
                    showToast('✓ All links copied!');
                    setTimeout(() => { btn.textContent = orig; btn.style.color = '#8b949e'; }, 1500);
                });
            });
            panel.querySelectorAll('.fs-copy-one').forEach(btn => {
                btn.addEventListener('click', async () => {
                    await navigator.clipboard.writeText(btn.dataset.url);
                    btn.textContent = '✓'; btn.style.color = '#00e5ff';
                    showToast('✓ Link copied!');
                    setTimeout(() => { btn.textContent = '📋'; btn.style.color = '#8b949e'; }, 1500);
                });
            });

            // Gear toggle
            panel.querySelector('#fs-detail-gear').addEventListener('click', () => {
                settingsPanel.style.display = settingsPanel.style.display === 'none' ? 'block' : 'none';
            });

            // Settings: scroll target
            settingsPanel.querySelectorAll('input[name="fs-scroll"]').forEach(radio => {
                radio.addEventListener('change', () => {
                    const s = loadDetailSettings(); s.scrollTarget = radio.value; saveDetailSettings(s);
                });
            });

            // Settings: auto-copy host
            settingsPanel.querySelector('#fs-autocopy-select').addEventListener('change', function () {
                const s = loadDetailSettings(); s.autoCopyHost = this.value; saveDetailSettings(s);
            });

            // Insert at top of #single
            const single = document.querySelector('#single');
            if (single) single.insertBefore(panel, single.firstChild);

            // Scroll behavior
            if (scrollTo === 'panel') {
                panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else if (scrollTo === 'links') {
                document.querySelector('#unlocked')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                // Off: the site may scroll to #unlocked anchor automatically — counteract it
                window.scrollTo({ top: 0, behavior: 'instant' });
                // Also intercept any delayed anchor scroll
                setTimeout(() => window.scrollTo({ top: 0, behavior: 'instant' }), 50);
                setTimeout(() => window.scrollTo({ top: 0, behavior: 'instant' }), 200);
            }

            // Auto-copy
            if (autoCopy && grouped[autoCopy]) {
                navigator.clipboard.writeText(grouped[autoCopy].urls.join('\n'))
                    .then(() => showToast(`✓ ${autoCopy} links copied!`))
                    .catch(() => {});
            }

            // ── Copy buttons in original section ─────────────────────────────
            for (const bq of blockquotes) {
                const links = bq.querySelectorAll('a');
                if (!links.length) continue;

                if (links.length > 1) {
                    const img = bq.previousElementSibling?.querySelector('img');
                    if (img && !img.parentElement.querySelector('.fs-copy-all-inline')) {
                        const allUrls = [...links].map(a => a.href).join('\n');
                        const copyAllBtn = document.createElement('button');
                        copyAllBtn.className = 'fs-copy-all-inline';
                        copyAllBtn.textContent = '📋 Copy all';
                        Object.assign(copyAllBtn.style, {
                            cursor: 'pointer', fontSize: '12px', color: '#e6edf3',
                            background: '#21262d', border: '1px solid #444c56',
                            borderRadius: '5px', padding: '4px 10px',
                            userSelect: 'none', marginLeft: '10px', verticalAlign: 'middle',
                        });
                        copyAllBtn.addEventListener('click', async () => {
                            await navigator.clipboard.writeText(allUrls);
                            copyAllBtn.textContent = '✓ Copied'; copyAllBtn.style.color = '#00e5ff'; copyAllBtn.style.borderColor = '#00e5ff';
                            showToast('✓ All links copied!');
                            setTimeout(() => { copyAllBtn.textContent = '📋 Copy all'; copyAllBtn.style.color = '#e6edf3'; copyAllBtn.style.borderColor = '#444c56'; }, 1500);
                        });
                        img.after(copyAllBtn);
                    }
                }

                for (const a of links) {
                    if (a.parentElement.classList.contains('fs-link-row')) continue;
                    const row = document.createElement('div');
                    row.className = 'fs-link-row';
                    Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '8px', margin: '4px 0' });
                    a.parentNode.insertBefore(row, a);
                    const copyBtn = document.createElement('button');
                    copyBtn.textContent = '📋 Copy';
                    Object.assign(copyBtn.style, {
                        cursor: 'pointer', fontSize: '12px', color: '#e6edf3',
                        background: '#21262d', border: '1px solid #444c56',
                        borderRadius: '5px', padding: '4px 10px',
                        userSelect: 'none', flexShrink: '0', whiteSpace: 'nowrap',
                    });
                    copyBtn.addEventListener('click', async () => {
                        await navigator.clipboard.writeText(a.href);
                        copyBtn.textContent = '✓ Copied'; copyBtn.style.color = '#00e5ff'; copyBtn.style.borderColor = '#00e5ff';
                        showToast('✓ Link copied!');
                        setTimeout(() => { copyBtn.textContent = '📋 Copy'; copyBtn.style.color = '#e6edf3'; copyBtn.style.borderColor = '#444c56'; }, 1500);
                    });
                    row.appendChild(copyBtn);
                    row.appendChild(a);
                }
            }

        }, 300);
    }

    function findContainer() {
        return document.querySelector('div.peliculas') || document.querySelector('.box');
    }

    function waitForContainer() {
        if (isDetailPage()) {
            initDetailPage();
            return;
        }
        const container = findContainer();
        if (container) {
            init(container);
        } else {
            setTimeout(waitForContainer, 400);
        }
    }

    waitForContainer();

})();
