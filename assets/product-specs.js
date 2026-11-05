/*
 * "פרטים טכניים" from the description (sections/main-product, snippets/product-specs).
 *
 * Many descriptions carry the technical details as loose lines: "<p>גודל<br>47.4 מ"מ</p>" pairs under
 * "<p>מידות ומשקל</p>" headings, "label<TAB>value" lines, "<li>label: value</li>" lists or a <table>.
 * In the "מידע נוסף" panel they read as one long column. This module finds those runs, removes them
 * from the description and adds them to the "פרטים טכניים" panel as groups of label | value rows,
 * with the same markup as the custom.specs table, so they get the same styles.
 *
 * Conservative on purpose: a run needs at least 3 rows and mostly short values (a value that is a
 * sentence is prose, not a spec), media and long paragraphs end it. Anything not recognised stays
 * in the description untouched. When custom.specs is filled, it is the curated table: the runs are
 * removed from the description and not added again. Without JavaScript the page stays as Liquid
 * rendered it.
 */
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION',
  'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P',
  'PRE', 'SECTION', 'TABLE', 'UL',
]);
const MEDIA = 'img, picture, video, iframe, svg, object, embed, audio, canvas';
const GENERIC_TITLE = /^(מפרט|טכני$|פרטים טכניים|מאפיינים טכניים|נתונים טכניים|נתונים עיקריים|specs?\b|specifications?\b|technical\b)/i;
const TABLE_HEADER = /^(מאפיין|מאפיינים|פירוט|תכונה|ערך|פרמטר|קטגוריה|נתון|נתונים|נתונים וערכים|מאפיין טכני)$/;
const ROWISH = new Set(['ROW', 'FLAG', 'CONT', 'SHORT']);
const RUNNABLE = new Set(['ROW', 'HEADING', 'FLAG', 'SHORT']);

const clean = (text) =>
  (text || '')
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/[    ]+/g, ' ')
    .replace(/ *\t */g, '\t')
    .trim();
const BULLET = /^[•·▪●◦\-–—*]\s*/;
const words = (text) => text.split(/\s+/).filter(Boolean).length;
const stripColon = (text) => text.replace(BULLET, '').replace(/\s*[:：]\s*$/, '').trim();
const isLabel = (text) => {
  const label = stripColon(text);
  return label.length > 0 && label.length <= 45 && words(label) <= 7 && !/[.!?,;]$/.test(label) && !label.includes('\t');
};
const isHeadingText = (text) => text.length <= 50 && words(text) <= 7 && !/[.!?,;]$/.test(text);
// A spec value is a few words ("47.4 מ"מ", "Dual GPS (L1+L5)"); a sentence is prose.
const isShortValue = (value) => value.length <= 60 && words(value) <= 6 && !/[.!?]$/.test(value);
const isProseValue = (value) => value.length > 80 || words(value) > 8;
const isShortLabel = (label) => words(label) <= 4;
/** "A title<br>a sentence or two": marketing copy shaped like a row. */
const isProseRow = (item) => {
  if (item.kind !== 'ROW') return false;
  const joined = item.values.join(' ');
  return joined.length > 90 || words(joined) > 12 || item.values.some((value) => isProseValue(value) || (/[.!?]$/.test(value) && words(value) > 3));
};
const PAIR = /^([^:：\n]{1,45}?)\s*[:：]\s+(\S[\s\S]*)$/;
const BULLET_PAIR = /^[•·▪●◦\-–—*]\s*([^:：\n]{1,45}?)\s*[:：]\s*(\S[\s\S]*)$/;
const isPairLine = (text) => {
  const pair = text.match(PAIR) || text.match(BULLET_PAIR);
  return Boolean(pair && isLabel(pair[1]) && pair[2].length <= 160);
};
/** Quality of a set of rows: mostly short labels and short values, as in a real spec sheet. */
function looksLikeSpecs(rows, minimum) {
  if (rows.length < minimum) return false;
  const values = rows.flatMap((row) => row.values);
  const shortValues = values.filter(isShortValue).length;
  const shortLabels = rows.filter((row) => !row.label || isShortLabel(row.label)).length;
  return shortValues >= values.length * 0.5 && shortLabels >= rows.length * 0.6;
}

/** Leaf blocks in document order: runs of inline nodes, and tables. */
function collectBlocks(root) {
  const blocks = [];
  const walk = (element) => {
    let run = [];
    const flush = () => {
      if (run.length) blocks.push({ element, nodes: run, tag: element === root ? 'ROOT' : element.tagName });
      run = [];
    };
    for (const node of [...element.childNodes]) {
      if (node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(node.tagName)) {
        flush();
        if (node.tagName === 'TABLE') blocks.push({ table: node });
        else if (node.tagName !== 'HR') walk(node);
      } else if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
        run.push(node);
      }
    }
    flush();
  };
  walk(root);
  return blocks;
}

/** The block's lines, split at <br> (also a <br> nested in <strong>), each with its live Range. */
function linesOf(block) {
  const first = block.nodes[0];
  const last = block.nodes[block.nodes.length - 1];
  const breaks = [];
  for (const node of block.nodes) {
    if (node.nodeName === 'BR') breaks.push(node);
    else if (node.nodeType === Node.ELEMENT_NODE) breaks.push(...node.querySelectorAll('br'));
  }
  const lines = [];
  for (let index = 0; index <= breaks.length; index += 1) {
    const range = document.createRange();
    if (index === 0) range.setStartBefore(first);
    else range.setStartAfter(breaks[index - 1]);
    if (index < breaks.length) range.setEndBefore(breaks[index]);
    else range.setEndAfter(last);
    const fragment = range.cloneContents();
    lines.push({ text: clean(fragment.textContent), media: Boolean(fragment.querySelector(MEDIA)) });
  }
  return { lines, breaks, first, last };
}

/**
 * One line. `alone`: the line is its whole block (<p>מסך</p>), the only place a group heading
 * comes from; a short line inside a block of lines, or one with digits, is a value (SHORT).
 */
function lineItem(text, tag, alone, bold) {
  if (/^H[1-6]$/.test(tag) && text.length <= 60 && !text.includes('\t')) {
    return { kind: 'HEADING', text: stripColon(text), strong: true };
  }
  const cells = text.split('\t').map(clean).filter(Boolean);
  if (cells.length >= 2 && isLabel(cells[0])) {
    return { kind: 'ROW', label: stripColon(cells[0]), values: [cells.slice(1).join(' ')] };
  }
  const pair = text.match(PAIR) || text.match(BULLET_PAIR);
  if (pair && isLabel(pair[1]) && pair[2].length <= 160) {
    return { kind: 'ROW', label: stripColon(pair[1]), values: [pair[2].trim()], alonePair: alone, text };
  }
  const title = stripColon(text);
  if (/^H[1-6]$/.test(tag) && text.length <= 60) return { kind: 'HEADING', text: title, strong: true };
  if (isHeadingText(title) && GENERIC_TITLE.test(title)) return { kind: 'HEADING', text: title, strong: true };
  if (isHeadingText(title)) {
    if (tag === 'LI' || BULLET.test(text)) return { kind: 'FLAG', text: title };
    if (alone && !/\d/.test(title)) return { kind: 'HEADING', text: title, strong: bold };
    return { kind: 'SHORT', text: title };
  }
  return { kind: 'OTHER', text };
}

const boldText = (nodes) =>
  nodes
    .map((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      if (/^(STRONG|B)$/.test(node.tagName)) return node.textContent;
      return [...node.querySelectorAll('strong, b')].map((inner) => inner.textContent).join('');
    })
    .join('');

/** Items of one text block; each knows which of the block's lines it covers. */
function itemsOfBlock(block) {
  const info = linesOf(block);
  block.info = info;
  const { lines } = info;
  const items = [];
  const push = (item, from, to) => items.push({ ...item, block, from, to });
  const segments = [];
  let segment = [];
  lines.forEach((line, index) => {
    if (!line.text && !line.media) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else segment.push(index);
  });
  if (segment.length) segments.push(segment);

  for (const indexes of segments) {
    const seg = indexes.map((index) => lines[index]);
    const from = indexes[0];
    const to = indexes[indexes.length - 1];
    if (seg.some((line) => line.media)) {
      push({ kind: 'OTHER', text: '', media: true }, from, to);
      continue;
    }
    const tabbed = seg.some((line) => /\S\t\S/.test(line.text));
    const head = seg[0].text;
    // "label<br>value" only when the lines are not themselves "label: value" pairs or bullets.
    const listy = seg.filter((line) => isPairLine(line.text) || BULLET.test(line.text)).length;
    if (
      !tabbed &&
      seg.length >= 2 &&
      seg.length <= 16 &&
      isLabel(head) &&
      !BULLET.test(head) &&
      !isPairLine(head) &&
      listy < seg.length / 2 &&
      !GENERIC_TITLE.test(head) &&
      seg.slice(1).every((line) => line.text.length <= 200)
    ) {
      push({ kind: 'ROW', label: stripColon(head), values: seg.slice(1).map((line) => line.text), blockRow: true }, from, to);
      continue;
    }
    // "<strong>תצוגה:</strong><br>גודל: 6.7 אינץ'<br>…": a heading over its own list of pairs.
    let rest = indexes;
    if (
      !tabbed &&
      seg.length >= 3 &&
      isHeadingText(stripColon(head)) &&
      !isPairLine(head) &&
      !BULLET.test(head) &&
      seg.slice(1).filter((line) => isPairLine(line.text) || BULLET.test(line.text)).length >= (seg.length - 1) / 2
    ) {
      push({ kind: 'HEADING', text: stripColon(head), strong: true }, from, from);
      rest = indexes.slice(1);
    }
    const alone = segments.length === 1 && indexes.length === 1;
    const bold = alone && clean(boldText(block.nodes)) === seg[0].text;
    for (const index of rest) push(lineItem(lines[index].text, block.tag, alone, bold), index, index);
  }
  return items;
}

function cellLines(cell) {
  const copy = cell.cloneNode(true);
  copy.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  copy.querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6').forEach((block) => block.append('\n'));
  return copy.textContent.split('\n').map(clean).filter(Boolean);
}

/** A 2 column (label | value) or 3 column (group | label | value) table becomes groups. */
function tableItem(table) {
  const rows = [...table.rows].map((tr) => ({ tr, cells: [...tr.cells].map(cellLines) }));
  const filled = rows.filter((row) => row.cells.some((cell) => cell.length));
  if (!filled.length) return { kind: 'EMPTY', table };
  const width = Math.max(...filled.map((row) => row.cells.length));
  if (width < 2 || width > 3) return { kind: 'OTHER', table, text: '' };
  let body = filled;
  const firstRow = body[0];
  const headerLike =
    firstRow.tr.parentElement?.tagName === 'THEAD' ||
    [...firstRow.tr.cells].every((cell) => cell.tagName === 'TH') ||
    firstRow.cells.every((cell) => TABLE_HEADER.test(cell.join(' ')));
  if (headerLike) body = body.slice(1);

  const groups = [];
  let group = null;
  for (const { cells } of body) {
    const [a = [], b = [], c = []] = cells;
    const title = width === 3 ? a.join(' ') : '';
    const label = (width === 3 ? b : a).join(' ');
    const values = width === 3 ? c : b;
    if (!group || (title && stripColon(title) !== group.title)) {
      group = { title: stripColon(title), rows: [] };
      groups.push(group);
    }
    // A cell of "label: value" lines (Samsung's tables) is a group of its own.
    if (width === 2 && label && values.length >= 2 && values.every(isPairLine)) {
      const rows = values.map((line) => {
        const pair = line.match(PAIR) || line.match(BULLET_PAIR);
        return { label: stripColon(pair[1]), values: [pair[2].trim()] };
      });
      groups.push({ title: stripColon(label), rows });
      group = null;
      continue;
    }
    if (label && values.length) group.rows.push({ label: stripColon(label), values });
    else if (!label && values.length && group.rows.length) group.rows[group.rows.length - 1].values.push(...values);
    else if (label && !values.length) group.rows.push({ label: null, values: [label] });
  }
  const all = groups.flatMap((item) => item.rows);
  if (!looksLikeSpecs(all, 2) || all.filter((row) => !row.label || isLabel(row.label)).length < all.length * 0.8) {
    return { kind: 'OTHER', table, text: '' };
  }
  return { kind: 'TABLE', table, groups: groups.filter((item) => item.rows.length) };
}

function makeTitle(titles) {
  const kept = titles.filter((title) => title && !GENERIC_TITLE.test(title));
  if (!kept.length) return '';
  const [first, second] = kept.slice(-2);
  if (!second) return first;
  return second.startsWith(first) ? second : `${first} · ${second}`;
}

function runToGroups(run) {
  const groups = [];
  let group = null;
  let previous = null;
  let titles = [];
  let flags = null;
  for (const item of run) {
    if (item.kind === 'HEADING') {
      if (group && group.rows.length) {
        previous = group;
        group = null;
      }
      // Two plain lines between groups: the first still belongs to the row above it.
      const last = titles[titles.length - 1];
      if (last && !last.strong && previous && previous.rows.length) {
        previous.rows[previous.rows.length - 1].values.push(titles.pop().text);
      }
      titles.push(item);
      flags = null;
      continue;
    }
    if (!group) {
      group = { title: makeTitle(titles.map((title) => title.text)), rows: [] };
      groups.push(group);
      titles = [];
    }
    if (item.kind === 'ROW') {
      group.rows.push({ label: item.label, values: item.values });
      flags = null;
    } else if (item.kind === 'FLAG') {
      if (!flags) {
        flags = { label: null, values: [], flags: true };
        group.rows.push(flags);
      }
      flags.values.push(item.text);
    } else if ((item.kind === 'CONT' || item.kind === 'SHORT') && group.rows.length) {
      group.rows[group.rows.length - 1].values.push(item.text);
    } else if (item.kind === 'SHORT') {
      flags = { label: null, values: [item.text], flags: true };
      group.rows.push(flags);
    }
  }
  return groups.filter((item) => item.rows.length);
}

/** Splits the item list into accepted runs; returns { groups, consumed items }. */
function findRuns(items) {
  // "<p>ספורט: צלילה</p>" between "label<br>value" blocks is the heading of the next group.
  items.forEach((item, index) => {
    const before = items[index - 1];
    const after = items[index + 1];
    if (item.kind === 'ROW' && item.alonePair && after?.blockRow && (!before || before.blockRow || before.kind === 'HEADING')) {
      item.kind = 'HEADING';
      item.text = clean(item.text.replace(/\s*[:：]\s*/, ': '));
      item.strong = true;
    }
  });
  const runs = [];
  let index = 0;
  while (index < items.length) {
    const item = items[index];
    if (item.kind === 'TABLE') {
      const run = [item];
      const before = items[index - 1];
      if (before && before.kind === 'HEADING' && !before.used) run.unshift(before);
      runs.push({ items: run, groups: tableGroups(run) });
      index += 1;
      continue;
    }
    if (!RUNNABLE.has(item.kind)) {
      index += 1;
      continue;
    }
    const run = [];
    let next = index;
    while (next < items.length) {
      const current = items[next];
      const after = items[next + 1];
      if (RUNNABLE.has(current.kind)) {
        // Three short lines in a row are a list of features, not group headings.
        if (
          current.kind === 'HEADING' &&
          run.length >= 2 &&
          run[run.length - 1].kind === 'HEADING' &&
          run[run.length - 2].kind === 'HEADING' &&
          run.some((entry) => entry.kind === 'ROW')
        ) {
          break;
        }
        run.push(current);
        next += 1;
        continue;
      }
      // A longer line between two rows continues the row above it.
      if (
        current.kind === 'OTHER' &&
        !current.media &&
        current.text &&
        current.text.length <= 160 &&
        run.length &&
        run[run.length - 1].kind === 'ROW' &&
        after &&
        ['ROW', 'HEADING'].includes(after.kind)
      ) {
        current.kind = 'CONT';
        run.push(current);
        next += 1;
        continue;
      }
      break;
    }
    index = Math.max(next, index + 1);

    // The run starts at its first real spec row ("a title<br>a sentence" rows before it are prose
    // and stay in the description), with the heading right above it, and a generic "מפרט טכני"
    // a line or two higher.
    const firstRow = run.findIndex((entry) => entry.kind === 'ROW' && !isProseRow(entry));
    if (firstRow < 0) continue;
    let start = firstRow;
    if (start > 0 && run[start - 1].kind === 'HEADING') start -= 1;
    if (start > 0 && run[start - 1].kind === 'HEADING' && GENERIC_TITLE.test(run[start - 1].text)) start -= 1;
    for (let back = firstRow - 1; back >= Math.max(0, firstRow - 3); back -= 1) {
      if (!['HEADING', 'SHORT'].includes(run[back].kind)) break;
      if (run[back].kind === 'HEADING' && GENERIC_TITLE.test(run[back].text)) {
        start = Math.min(start, back);
        break;
      }
    }
    const trimmed = run.slice(start);
    // Trailing headings belong to what follows, trailing prose rows to the description.
    while (
      trimmed.length &&
      (['HEADING', 'SHORT'].includes(trimmed[trimmed.length - 1].kind) || isProseRow(trimmed[trimmed.length - 1]))
    ) {
      trimmed.pop();
    }


    const rows = trimmed.filter((entry) => entry.kind === 'ROW');
    const headings = trimmed.filter((entry) => entry.kind === 'HEADING').length;
    const flags = trimmed.filter((entry) => entry.kind === 'FLAG' || entry.kind === 'SHORT').length;
    if (!looksLikeSpecs(rows, 3) || headings > rows.length || flags > rows.length) continue;
    runs.push({ items: trimmed, groups: runToGroups(trimmed) });
  }
  return runs;
}

function tableGroups(run) {
  const heading = run.find((item) => item.kind === 'HEADING');
  const table = run.find((item) => item.kind === 'TABLE');
  const title = heading ? makeTitle([heading.text]) : '';
  return table.groups.map((group, index) => ({ ...group, title: group.title || (index === 0 ? title : '') }));
}

/** Removes the consumed lines (whole blocks where possible), last first so ranges stay valid. */
function removeItems(items, root) {
  const byBlock = new Map();
  const tables = [];
  for (const item of items) {
    if (item.table) tables.push(item.table);
    else {
      if (!byBlock.has(item.block)) byBlock.set(item.block, new Set());
      for (let line = item.from; line <= item.to; line += 1) byBlock.get(item.block).add(line);
    }
  }
  const touched = new Set(tables.map((table) => table.parentElement));
  tables.forEach((table) => table.remove());

  for (const [block, used] of [...byBlock.entries()].reverse()) {
    const { lines, breaks, first, last } = block.info;
    const all = lines.every((line, index) => used.has(index) || (!line.text && !line.media));
    if (all) {
      const whole = block.element !== root && block.nodes.length === block.element.childNodes.length;
      if (whole) {
        touched.add(block.element.parentElement);
        block.element.remove();
      } else {
        touched.add(block.element);
        block.nodes.forEach((node) => node.remove());
      }
      continue;
    }
    touched.add(block.element);
    // Contiguous spans of used lines, removed from the end of the block backwards.
    const spans = [];
    [...used].sort((a, b) => a - b).forEach((line) => {
      const span = spans[spans.length - 1];
      if (span && line === span[1] + 1) span[1] = line;
      else spans.push([line, line]);
    });
    for (const [from, to] of spans.reverse()) {
      const range = document.createRange();
      if (from === 0) range.setStartBefore(first);
      else range.setStartBefore(breaks[from - 1]);
      if (to < breaks.length) range.setEndBefore(breaks[to]);
      else range.setEndAfter(last);
      if (from === 0 && to < breaks.length) range.setEndAfter(breaks[to]);
      range.deleteContents();
    }
  }

  // Tidy only what was changed: empty wrappers left behind, line breaks at the edges of a block, and
  // containers (a list, a wrapper div) that are now empty. Untouched markup is never cleaned.
  const isEmpty = (element) =>
    !clean(element.textContent) && !element.matches(MEDIA) && !element.querySelector(`${MEDIA}, hr`);
  for (let element of touched) {
    if (!element) continue;
    if (element.isConnected && element !== root) {
      element.querySelectorAll('*').forEach((child) => {
        if (child.isConnected && child.nodeName !== 'BR' && isEmpty(child)) child.remove();
      });
      for (const edge of ['firstChild', 'lastChild']) {
        let node = element[edge];
        while (node && (node.nodeName === 'BR' || (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()))) {
          const next = edge === 'firstChild' ? node.nextSibling : node.previousSibling;
          node.remove();
          node = next;
        }
      }
    }
    // Walk up from the changed element (or from where a removed one was) while containers are empty.
    while (element && element !== root && root.contains(element) && isEmpty(element)) {
      const parent = element.parentElement;
      element.remove();
      element = parent;
    }
  }
}

/** Finds the technical details in a description element; removes them and returns the groups. */
export function extractSpecs(root) {
  const items = [];
  for (const block of collectBlocks(root)) {
    if (block.table) items.push(tableItem(block.table));
    else items.push(...itemsOfBlock(block));
  }
  const runs = findRuns(items);
  const consumed = runs.flatMap((run) => run.items);
  const empties = items.filter((item) => item.kind === 'EMPTY');
  if (consumed.length || empties.length) removeItems([...consumed, ...empties], root);
  return runs.flatMap((run) => run.groups);
}

function renderGroups(groups, flagsLabel) {
  const fragment = document.createDocumentFragment();
  for (const group of groups) {
    const wrapper = document.createElement('div');
    wrapper.className = 'product-specs__group product-specs__group--description';
    if (group.title) {
      const title = document.createElement('h3');
      title.className = 'product-specs__title';
      title.textContent = group.title;
      wrapper.append(title);
    }
    const list = document.createElement('dl');
    list.className = 'product-specs__list';
    for (const row of group.rows) {
      const line = document.createElement('div');
      line.className = 'product-specs__row';
      const label = document.createElement('dt');
      label.className = 'product-specs__label';
      label.textContent = row.label || flagsLabel;
      const value = document.createElement('dd');
      value.className = 'product-specs__value';
      const inline = row.flags || (row.values.length >= 3 && row.values.every((text) => text.length <= 28));
      row.values.forEach((text, index) => {
        if (index) value.append(inline ? ' · ' : document.createElement('br'));
        value.append(text);
      });
      line.append(label, value);
      list.append(line);
    }
    wrapper.append(list);
    fragment.append(wrapper);
  }
  return fragment;
}

function enhance(scope) {
  const description = scope.querySelector('[data-product-description]');
  const specsItem = scope.querySelector('[data-product-specs-item]');
  if (!description || !specsItem || description.dataset.specsDone) return;
  description.dataset.specsDone = 'true';

  const groups = extractSpecs(description);
  const fromMetafield = specsItem.hasAttribute('data-specs-metafield');
  if (groups.length && !fromMetafield) {
    const panel = specsItem.querySelector('[data-product-specs-panel]');
    let table = panel.querySelector('.product-specs');
    if (!table) {
      table = document.createElement('div');
      table.className = 'product-specs';
      panel.append(table);
    }
    table.append(renderGroups(groups, specsItem.dataset.flagsLabel || ''));
    specsItem.hidden = false;
    scope.querySelectorAll('[data-product-specs-link]').forEach((link) => (link.hidden = false));
  }

  // A description that was only technical details: its panel goes, its links open the specs.
  const left = clean(description.textContent) || description.querySelector(MEDIA);
  if (!left) {
    const item = description.closest('details');
    if (item && !specsItem.hidden) {
      item.hidden = true;
      scope.querySelectorAll(`a[href="#${CSS.escape(item.id)}"]`).forEach((link) => {
        link.setAttribute('href', `#${specsItem.id}`);
      });
    }
  }
}

document.querySelectorAll('[data-product-specs-scope]').forEach(enhance);
