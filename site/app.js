/* SkillRig marketplace — registry browser. No dependencies, no build step. */
(() => {
  'use strict';

  const DATA = window.SKILLRIG_DATA;
  const PAGE_SIZE = 48;
  const REPO_URL = 'https://github.com/LIXIAO199115/skillrig';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const SECURITY_CLASS = {
    clean: 'sec-clean',
    review: 'sec-review',
    'high-risk': 'sec-highrisk',
    critical: 'sec-critical',
  };
  const SECURITY_LABEL = {
    clean: 'clean',
    review: 'review',
    'high-risk': 'high risk',
    critical: 'critical',
  };
  const LICENSE_HINT = {
    permissive: 'Permissive license',
    copyleft: 'Copyleft license',
    review: 'License needs review',
    restricted: 'License restrictions apply',
    unlicensed: 'No license declared',
  };

  const state = {
    query: '',
    filter: 'all',
    category: '',
    sort: 'quality',
    visible: PAGE_SIZE,
  };

  let results = [];
  let entryNo = new Map();
  let byId = new Map();
  let memberByName = new Map();
  let drawerOpen = false;
  let drawerTimer = null;
  let lastTrigger = null;
  const copyTimers = new WeakMap();

  if (!DATA) {
    failToLoad();
    return;
  }

  const els = {
    search: $('#search'),
    category: $('#category'),
    sort: $('#sort'),
    resultCount: $('#result-count'),
    body: $('#registry-body'),
    empty: $('#table-empty'),
    loadMore: $('#load-more'),
    packGrid: $('#pack-grid'),
    sourcesBody: $('#sources-body'),
    drawer: $('#drawer'),
    drawerInner: $('#drawer-inner'),
    scrim: $('#scrim'),
  };

  function init() {
    DATA.skills.forEach((skill, index) => {
      const number = index + 1;
      if (!entryNo.has(skill.id)) entryNo.set(skill.id, number);
      if (!byId.has(skill.id)) byId.set(skill.id, skill);
      const current = memberByName.get(skill.name);
      if (!current || skill.source.type === 'bundled') memberByName.set(skill.name, skill);
    });

    setStats();
    setCertificate();
    setChipCounts();
    fillCategories();
    renderPacks();
    renderSources();
    bindEvents();
    apply();
    createLiveRegion();
  }

  /* ---------- DOM helpers ---------- */

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('en-US');
  }

  function shortDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toISOString().slice(0, 10);
  }

  function shortHash(value) {
    const text = String(value || '');
    if (!text) return '—';
    const hex = text.replace(/^sha256:/, '');
    return `sha256:${hex.slice(0, 12)}…`;
  }

  function safeHttpUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
    } catch {
      return null;
    }
  }

  function repoLink(repo) {
    return /^[\w.-]+\/[\w.-]+$/.test(String(repo || '')) ? `https://github.com/${repo}` : null;
  }

  function commitLink(repo, commit) {
    const base = repoLink(repo);
    return base && /^[0-9a-f]{7,40}$/i.test(String(commit || '')) ? `${base}/commit/${commit}` : null;
  }

  function trustOf(skill) {
    return skill.source.type === 'bundled' ? 'curated' : skill.trust === 'official' ? 'official' : 'community';
  }

  function securityLabel(skill) {
    return SECURITY_LABEL[skill.security.badge] || 'unknown';
  }

  function entryLabel(skill) {
    const number = entryNo.get(skill.id);
    return number ? String(number).padStart(3, '0') : '—';
  }

  /* ---------- Header, certificate, counts ---------- */

  function setStats() {
    const values = {
      skills: DATA.skills.length,
      curated: DATA.skills.filter((skill) => skill.source.type === 'bundled').length,
      agents: DATA.meta.agentCount || DATA.agents.length,
      sources: DATA.meta.counts && DATA.meta.counts.sources != null ? DATA.meta.counts.sources : DATA.sources.filter((source) => source.enabled).length,
      clean: DATA.meta.clean,
    };
    $$('[data-stat]').forEach((node) => {
      const value = values[node.dataset.stat];
      if (value !== undefined) node.textContent = formatNumber(value);
    });
  }

  function setCertificate() {
    const meta = DATA.meta;
    const signed = shortDate(meta.signedAt);
    const digestHex = String(meta.digest || '').replace(/^sha256:/, '');
    const fields = {
      key: String(meta.keyId || '—').slice(0, 8),
      entries: `${formatNumber(DATA.skills.length)} skills · ${formatNumber(DATA.packs.length)} packs`,
      digest: digestHex ? `sha256:${digestHex.slice(0, 12)}…` : 'unsigned',
      signed,
      year: signed === '—' ? '—' : signed.slice(0, 4),
    };
    $$('[data-cert]').forEach((node) => {
      const value = fields[node.dataset.cert];
      if (value !== undefined) node.textContent = value;
    });
  }

  function setChipCounts() {
    const counts = {
      all: DATA.skills.length,
      curated: DATA.skills.filter((skill) => skill.source.type === 'bundled').length,
      upstream: DATA.skills.filter((skill) => skill.source.type !== 'bundled').length,
      blocked: DATA.skills.filter((skill) => skill.blocked).length,
      clean: DATA.skills.filter((skill) => skill.security.badge === 'clean').length,
    };
    $$('.chip[data-filter]').forEach((chip) => {
      let span = chip.querySelector('span');
      if (!span) {
        span = el('span');
        chip.append(span);
      }
      span.textContent = formatNumber(counts[chip.dataset.filter] || 0);
    });
  }

  function fillCategories() {
    if (!els.category) return;
    const fragment = document.createDocumentFragment();
    for (const category of DATA.categories) {
      fragment.append(el('option', { value: category.name, text: `${category.name} (${formatNumber(category.count)})` }));
    }
    els.category.append(fragment);
  }

  /* ---------- Registry ---------- */

  function searchScore(skill, tokens) {
    const name = skill.name.toLowerCase();
    const repo = skill.source.repo.toLowerCase();
    const description = skill.description.toLowerCase();
    const tags = skill.tags.join(' ').toLowerCase();
    const categories = skill.categories.join(' ').toLowerCase();
    let score = 0;
    for (const token of tokens) {
      let points = 0;
      if (name === token) points = 120;
      else if (name.startsWith(token)) points = 60;
      else if (name.includes(token)) points = 30;
      else if (tags.includes(token)) points = 16;
      else if (categories.includes(token)) points = 12;
      else if (repo.includes(token)) points = 8;
      else if (description.includes(token)) points = 4;
      if (!points) return -1;
      score += points;
    }
    return score;
  }

  const COMPARE = {
    quality: (a, b) => (b.quality.score || 0) - (a.quality.score || 0)
      || a.name.localeCompare(b.name)
      || a.source.repo.localeCompare(b.source.repo),
    name: (a, b) => a.name.localeCompare(b.name) || a.source.repo.localeCompare(b.source.repo),
    security: (a, b) => Number(a.blocked) - Number(b.blocked)
      || (b.security.score || 0) - (a.security.score || 0)
      || (b.quality.score || 0) - (a.quality.score || 0)
      || a.name.localeCompare(b.name),
    updated: (a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0)
      || a.name.localeCompare(b.name),
  };

  function apply() {
    const tokens = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const relevance = new Map();

    results = DATA.skills.filter((skill) => {
      if (state.filter === 'curated' && skill.source.type !== 'bundled') return false;
      if (state.filter === 'upstream' && skill.source.type === 'bundled') return false;
      if (state.filter === 'blocked' && !skill.blocked) return false;
      if (state.filter === 'clean' && skill.security.badge !== 'clean') return false;
      if (state.category && !skill.categories.includes(state.category)) return false;
      if (tokens.length) {
        const score = searchScore(skill, tokens);
        if (score < 0) return false;
        relevance.set(skill, score);
      }
      return true;
    });

    const base = COMPARE[state.sort] || COMPARE.quality;
    results.sort((a, b) => {
      if (tokens.length && state.sort === 'quality') {
        const difference = (relevance.get(b) || 0) - (relevance.get(a) || 0);
        if (difference) return difference;
      }
      return base(a, b);
    });

    state.visible = PAGE_SIZE;
    renderTable();
  }

  function renderTable() {
    const shown = results.slice(0, state.visible);
    const fragment = document.createDocumentFragment();
    shown.forEach((skill, index) => fragment.append(renderRow(skill, index + 1)));
    els.body.replaceChildren(fragment);

    els.empty.hidden = results.length !== 0;
    const remaining = results.length - state.visible;
    els.loadMore.hidden = remaining <= 0;
    if (remaining > 0) {
      els.loadMore.replaceChildren(
        document.createTextNode(`Load ${Math.min(PAGE_SIZE, remaining)} more `),
        el('span', { 'aria-hidden': 'true' }, '↓'),
      );
    }

    const total = results.length;
    let count = `${formatNumber(total)} ${total === 1 ? 'entry' : 'entries'}`;
    if (state.query.trim()) count += ` matching “${state.query.trim()}”`;
    if (remaining > 0) count += ` · showing ${formatNumber(state.visible)}`;
    els.resultCount.textContent = count;
  }

  function renderRow(skill, number) {
    const trust = trustOf(skill);
    const trustTags = el('div', { class: 'tag-stack' });
    trustTags.append(el('span', { class: `tag ${trust}`, text: trust }));
    if (skill.blocked) trustTags.append(el('span', { class: 'tag blocked', text: 'blocked' }));

    const security = el('span', {
      class: `sec-badge ${SECURITY_CLASS[skill.security.badge] || ''}`.trim(),
      title: `Security score ${skill.security.score}/100`,
    }, securityLabel(skill));

    const license = el('span', {
      class: 'lic',
      title: LICENSE_HINT[skill.licenseStatus] || 'License status unknown',
    }, skill.license || 'Unlicensed');

    const row = el('tr', {
      'data-skill': skill.id,
      'data-entry': String(number),
      class: skill.blocked ? 'is-blocked' : '',
    },
      el('td', { class: 'reg-no col-no', text: String(number).padStart(3, '0') }),
      el('td', { class: 'col-name' },
        el('span', { class: 'reg-name', text: skill.name }),
        el('span', {
          class: 'reg-sub',
          text: `${skill.source.type === 'bundled' ? 'SkillRig' : skill.source.repo} · v${skill.version}`,
          title: skill.source.path || skill.source.repo,
        }),
      ),
      el('td', { class: 'col-desc' }, el('p', { class: 'reg-desc', text: skill.description })),
      el('td', { class: 'col-trust' }, trustTags),
      el('td', { class: 'col-grade' },
        el('span', { class: 'grade' }, skill.quality.grade, el('small', { text: String(skill.quality.score) })),
      ),
      el('td', { class: 'col-sec' }, security),
      el('td', { class: 'col-license' }, license),
      el('td', { class: 'col-act' },
        el('button', {
          class: 'row-open',
          type: 'button',
          'aria-label': `Inspect ${skill.name}`,
          'data-open': skill.id,
        }, '→'),
      ),
    );

    if (skill.blocked) row.setAttribute('aria-label', `${skill.name} — blocked by the security gate`);
    return row;
  }

  /* ---------- Packs ---------- */

  function renderPacks() {
    if (!els.packGrid) return;
    const fragment = document.createDocumentFragment();
    DATA.packs.forEach((pack, index) => {
      const members = el('ul', { class: 'pack-members' });
      for (const name of pack.skills) {
        const member = memberByName.get(name);
        members.append(el('li', null,
          el('span', { text: name }),
          el('span', { class: 'm-grade', text: member ? member.quality.grade : '—' }),
        ));
      }

      const command = `skillrig install pack/${pack.name} --agent codex`;
      const card = el('article', { class: 'pack-card' },
        el('div', { class: 'pack-head' },
          el('span', { class: 'pack-no', text: `PACK ${String(index + 1).padStart(2, '0')}` }),
          el('span', { class: 'tag curated', text: `v${pack.version}` }),
        ),
        el('h3', { class: 'pack-title', text: pack.title }),
        el('p', { class: 'pack-desc', text: pack.description }),
        members,
        el('div', { class: 'pack-command' },
          el('code', { text: command }),
          copyButton(command, `Copy install command for ${pack.title}`),
        ),
        el('p', {
          class: 'pack-more',
          text: `${pack.skills.length} skills${pack.tags.length ? ` · ${pack.tags.slice(0, 3).join(' / ')}` : ''}`,
        }),
      );
      fragment.append(card);
    });
    els.packGrid.replaceChildren(fragment);
  }

  /* ---------- Provenance table ---------- */

  function renderSources() {
    if (!els.sourcesBody) return;
    const fragment = document.createDocumentFragment();
    for (const source of DATA.sources) {
      const repoHref = repoLink(source.repo);
      const repoCell = el('td');
      if (repoHref) {
        repoCell.append(el('a', {
          class: 'repo',
          href: repoHref,
          title: source.label ? `${source.label} — ${source.repo}` : source.repo,
          text: source.repo,
        }));
      } else {
        repoCell.append(el('span', { class: 'repo', text: source.repo }));
      }

      const commitHref = commitLink(source.repo, source.commit);
      const commitCell = el('td', { class: 'commit', title: source.commit || 'Not pinned' });
      if (commitHref) {
        commitCell.append(el('a', { href: commitHref, text: source.commit.slice(0, 7) }));
      } else {
        commitCell.textContent = source.commit ? source.commit.slice(0, 7) : '—';
      }

      const license = source.license
        || (!source.enabled ? 'Not checked' : source.licenseStatus === 'unlicensed' ? 'Unlicensed' : '—');

      let statusNode;
      if (source.error) {
        statusNode = el('span', { class: 'status is-blocked', text: 'Error' });
      } else if (!source.enabled) {
        statusNode = el('span', { class: 'status is-external', text: 'External catalog' });
      } else if (source.blocked) {
        statusNode = el('span', { class: 'status' },
          'Indexed ',
          el('span', { class: 'status-blocked', text: `· ${source.blocked} blocked` }),
        );
      } else {
        statusNode = el('span', { class: 'status', text: 'Indexed' });
      }
      statusNode.title = source.reason
        || source.error
        || (source.skipped ? `${source.skipped} skill(s) skipped during crawl` : '');

      fragment.append(el('tr', { class: source.enabled ? '' : 'external' },
        repoCell,
        commitCell,
        el('td', { class: 'lic', title: LICENSE_HINT[source.licenseStatus] || '', text: license }),
        el('td', { class: 'num', text: source.skills == null ? '—' : formatNumber(source.skills) }),
        el('td', null, statusNode),
      ));
    }
    els.sourcesBody.replaceChildren(fragment);
  }

  /* ---------- Drawer ---------- */

  function openDrawer(skill, trigger, number) {
    if (!els.drawer || !els.drawerInner) return;
    lastTrigger = trigger || document.activeElement;
    els.drawerInner.replaceChildren(...drawerContent(skill, number));

    clearTimeout(drawerTimer);
    els.drawer.setAttribute('aria-hidden', 'false');
    els.scrim.hidden = false;
    document.body.classList.add('no-scroll');
    drawerOpen = true;

    requestAnimationFrame(() => {
      els.scrim.classList.add('is-visible');
      els.drawer.classList.add('is-open');
    });

    const close = els.drawerInner.querySelector('.drawer-close');
    if (close) close.focus({ preventScroll: true });
  }

  function closeDrawer() {
    if (!drawerOpen) return;
    drawerOpen = false;
    els.drawer.classList.remove('is-open');
    els.scrim.classList.remove('is-visible');
    els.drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('no-scroll');
    drawerTimer = setTimeout(() => {
      els.scrim.hidden = true;
      els.drawerInner.replaceChildren();
    }, 320);
    if (lastTrigger && lastTrigger.isConnected) lastTrigger.focus({ preventScroll: true });
  }

  function drawerContent(skill, number) {
    const trust = trustOf(skill);
    const close = el('button', { class: 'drawer-close', type: 'button', 'aria-label': 'Close inspector' }, '×');

    const kicker = el('div', { class: 'drawer-kicker' },
      el('span', { class: `tag ${trust}`, text: trust }),
      skill.blocked ? el('span', { class: 'tag blocked', text: 'blocked' }) : null,
      el('span', { class: 'tag', text: `scan ${securityLabel(skill)}` }),
    );

    const title = el('h2', { id: 'drawer-title', text: skill.name });
    const description = el('p', { class: 'drawer-desc', text: skill.description });

    const nodes = [
      el('div', { class: 'drawer-top' },
        el('span', { class: 'mono-label', text: `Entry No. ${String(number || entryNo.get(skill.id) || 0).padStart(3, '0')}` }),
        close,
      ),
      kicker,
      title,
      description,
    ];

    if (skill.blocked) {
      const counts = skill.security.counts || {};
      const found = [];
      if (counts.critical) found.push(`${counts.critical} critical`);
      if (counts.high) found.push(`${counts.high} high`);
      nodes.push(el('p', {
        class: 'drawer-warning',
        text: `Blocked by the security gate${found.length ? ` (${found.join(', ')} findings)` : ''}. The installer refuses this entry unless you pass --allow-risky. Read the scan before overriding it.`,
      }));
    }

    const command = `skillrig install ${skill.name}`;
    nodes.push(el('div', { class: 'drawer-section' },
      el('h3', { text: 'Install' }),
      el('div', { class: 'drawer-command' },
        el('div', { class: 'command-line' },
          el('code', { text: command }),
          copyButton(command, `Copy install command for ${skill.name}`),
        ),
      ),
    ));

    const meta = el('dl', { class: 'drawer-meta' });
    const metaItems = [
      ['Quality', `${skill.quality.grade} · ${skill.quality.score}/100`],
      ['Security', `${securityLabel(skill)} · ${skill.security.score}/100`],
      ['License', skill.license || 'Unlicensed'],
      ['Version', `v${skill.version}`],
      ['Source', skill.source.repo],
      ['Files', `${formatNumber(skill.fileCount)} · ${formatNumber(skill.bodyLines)} lines`],
      ['Integrity', shortHash(skill.integrity), 'mono'],
      ['Updated', skill.updatedAt ? shortDate(skill.updatedAt) : skill.source.type === 'bundled' ? 'Edition 1.0' : '—'],
    ];
    for (const [label, value, className] of metaItems) {
      meta.append(el('div', null,
        el('dt', { text: label }),
        el('dd', { class: className, text: value }),
      ));
    }
    nodes.push(meta);

    if (skill.source.path) {
      nodes.push(el('div', { class: 'drawer-section' },
        el('h3', { text: 'Provenance' }),
        el('p', { class: 'drawer-source', text: `${skill.source.repo}/${skill.source.path}` }),
      ));
    }

    if (skill.security.suppressed) {
      nodes.push(el('div', { class: 'drawer-section' },
        el('h3', { text: 'Suppressed findings' }),
        el('p', { class: 'drawer-desc', text: `${skill.security.suppressed} finding(s) were silenced by an explicit skillrig-ignore directive and remain in the audit record.` }),
      ));
    }

    if (skill.requires.length) {
      nodes.push(el('div', { class: 'drawer-section' },
        el('h3', { text: 'Requires' }),
        el('div', { class: 'drawer-tags' }, skill.requires.map((name) => el('span', { text: name }))),
      ));
    }

    if (skill.conflicts.length) {
      nodes.push(el('div', { class: 'drawer-section' },
        el('h3', { text: 'Conflicts' }),
        el('div', { class: 'drawer-tags' }, skill.conflicts.map((name) => el('span', { text: name }))),
      ));
    }

    const labels = [...new Set([...skill.categories, ...skill.tags])];
    if (labels.length) {
      nodes.push(el('div', { class: 'drawer-section' },
        el('h3', { text: 'Labels' }),
        el('div', { class: 'drawer-tags' }, labels.map((label) => el('span', { text: label }))),
      ));
    }

    const links = el('div', { class: 'drawer-links' });
    const sourceUrl = safeHttpUrl(skill.source.url) || repoLink(skill.source.repo);
    if (sourceUrl) links.append(el('a', { href: sourceUrl, text: 'View source ↗' }));
    links.append(el('a', { href: `${REPO_URL}/blob/main/docs/skill-spec.md`, text: 'Skill format ↗' }));
    links.append(el('a', { href: `${REPO_URL}/blob/main/docs/security-model.md`, text: 'Security model ↗' }));
    nodes.push(links);

    close.addEventListener('click', closeDrawer);
    return nodes;
  }

  /* ---------- Copy ---------- */

  function copyButton(command, label) {
    return el('button', {
      class: 'copy-btn small',
      type: 'button',
      'data-copy': command,
      'aria-label': label,
    }, el('span', { class: 'copy-icon', 'aria-hidden': 'true' }));
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* Fall through to the selection-based path. */
    }
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-1000px';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    } catch {
      return false;
    }
  }

  function createLiveRegion() {
    const region = el('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite', id: 'copy-status' });
    document.body.append(region);
  }

  function flashCopied(button) {
    button.classList.add('copied');
    const text = button.querySelector('.copy-text');
    if (text) {
      if (!text.dataset.original) text.dataset.original = text.textContent;
      text.textContent = 'Copied';
    }
    clearTimeout(copyTimers.get(button));
    copyTimers.set(button, setTimeout(() => {
      button.classList.remove('copied');
      if (text) text.textContent = text.dataset.original || 'Copy';
    }, 1600));
  }

  /* ---------- Events ---------- */

  function bindEvents() {
    els.search.addEventListener('input', () => {
      state.query = els.search.value;
      apply();
    });

    els.search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && els.search.value) {
        event.preventDefault();
        els.search.value = '';
        state.query = '';
        apply();
      }
    });

    els.category.addEventListener('change', () => {
      state.category = els.category.value;
      apply();
    });

    els.sort.addEventListener('change', () => {
      state.sort = els.sort.value;
      apply();
    });

    $$('.chip[data-filter]').forEach((chip) => {
      chip.setAttribute('aria-pressed', String(chip.dataset.filter === state.filter));
      chip.addEventListener('click', () => {
        state.filter = chip.dataset.filter;
        $$('.chip[data-filter]').forEach((other) => {
          const active = other === chip;
          other.classList.toggle('is-active', active);
          other.setAttribute('aria-pressed', String(active));
        });
        apply();
      });
    });

    $('#reset-filters').addEventListener('click', () => {
      state.query = '';
      state.filter = 'all';
      state.category = '';
      state.sort = 'quality';
      els.search.value = '';
      els.category.value = '';
      els.sort.value = 'quality';
      $$('.chip[data-filter]').forEach((chip) => {
        const active = chip.dataset.filter === 'all';
        chip.classList.toggle('is-active', active);
        chip.setAttribute('aria-pressed', String(active));
      });
      apply();
      els.search.focus();
    });

    els.loadMore.addEventListener('click', () => {
      state.visible += PAGE_SIZE;
      renderTable();
    });

    els.body.addEventListener('click', (event) => {
      if (event.target.closest('[data-copy]')) return;
      const row = event.target.closest('tr[data-skill]');
      if (!row) return;
      if (window.getSelection && window.getSelection().toString()) return;
      const skill = byId.get(row.dataset.skill);
      if (skill) openDrawer(skill, row.querySelector('.row-open'), Number(row.dataset.entry));
    });

    els.scrim.addEventListener('click', closeDrawer);

    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-copy]');
      if (!button) return;
      event.preventDefault();
      const command = button.getAttribute('data-copy');
      copyText(command).then((copied) => {
        const region = $('#copy-status');
        if (region) region.textContent = copied ? 'Command copied to clipboard.' : 'Copy failed. Select the command and copy it manually.';
        if (copied) flashCopied(button);
      });
    });

    document.addEventListener('keydown', (event) => {
      if (drawerOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          closeDrawer();
          return;
        }
        if (event.key !== 'Tab') return;
        const focusable = $$('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])', els.drawerInner)
          .filter((node) => node.getClientRects().length > 0);
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (!els.drawerInner.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      if (event.key === '/' && !isTyping(event.target)) {
        event.preventDefault();
        els.search.focus();
        els.search.select();
      }
    });
  }

  function isTyping(node) {
    if (!node) return false;
    const tag = node.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
  }

  /* ---------- Failure ---------- */

  function failToLoad() {
    const count = document.querySelector('#result-count');
    if (count) count.textContent = 'Registry data failed to load. Read registry/index.json directly.';
    const body = document.querySelector('#registry-body');
    if (body) {
      body.replaceChildren();
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 8;
      cell.textContent = 'The generated registry data is missing. Run npm run build:site, or read the index on GitHub.';
      row.append(cell);
      body.append(row);
    }
    console.error('SkillRig: window.SKILLRIG_DATA is missing. Run node scripts/build-site.mjs.');
  }

  init();
})();
