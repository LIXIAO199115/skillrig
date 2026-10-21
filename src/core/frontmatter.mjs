const BLOCK_RE = /^[|>][+-]?$/;

function unquoteDouble(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

export function unquote(value) {
  const text = String(value).trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) return unquoteDouble(text);
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text;
}

export function parseScalar(value) {
  const text = unquote(value);
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  return text;
}

function findColon(text) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth -= 1;
    else if (ch === ':' && depth === 0) {
      const next = text[i + 1];
      if (next === undefined || /\s/.test(next)) return i;
    }
  }
  return -1;
}

function stripComment(value) {
  let quote = null;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#' && (i === 0 || /\s/.test(value[i - 1]))) return value.slice(0, i).trimEnd();
  }
  return value.trimEnd();
}

function splitTopLevel(text, separator = ',') {
  const parts = [];
  let quote = null;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth -= 1;
    else if (ch === separator && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function parseInlineArray(text) {
  const body = text.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
  if (!body) return [];
  return splitTopLevel(body).map((item) => parseScalar(item));
}

function parseInlineMap(text) {
  const body = text.trim().replace(/^\{/, '').replace(/\}$/, '').trim();
  if (!body) return {};
  const result = {};
  for (const part of splitTopLevel(body)) {
    const colon = findColon(part);
    if (colon < 0) continue;
    result[unquote(part.slice(0, colon))] = parseScalar(part.slice(colon + 1));
  }
  return result;
}

export function parseYaml(source) {
  const lines = String(source).split(/\r?\n/);
  const tokens = [];
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const withoutTabs = raw.replace(/\t/g, '  ');
    if (!withoutTabs.trim() || withoutTabs.trim().startsWith('#')) continue;
    const indent = withoutTabs.match(/^ */)[0].length;
    tokens.push({ indent, text: withoutTabs.trim(), raw, line: index + 1 });
  }

  let cursor = 0;

  function parseNode(indent) {
    if (cursor >= tokens.length) return null;
    if (tokens[cursor].indent < indent) return null;
    if (tokens[cursor].text === '-' || tokens[cursor].text.startsWith('- ')) {
      return parseSequence(tokens[cursor].indent);
    }
    return parseMapping(tokens[cursor].indent);
  }

  function parseBlockScalar(indicator, parentIndent) {
    const block = [];
    while (cursor < tokens.length && tokens[cursor].indent > parentIndent) {
      block.push(tokens[cursor].raw);
      cursor += 1;
    }
    let minIndent = Infinity;
    for (const raw of block) {
      if (!raw.trim()) continue;
      minIndent = Math.min(minIndent, raw.match(/^ */)[0].length);
    }
    const dedented = block.map((raw) => raw.slice(Number.isFinite(minIndent) ? minIndent : 0));
    let value;
    if (indicator.startsWith('|')) {
      value = dedented.join('\n');
    } else {
      value = dedented
        .map((line) => line.trim())
        .filter((line, index, all) => !(line === '' && (index === 0 || index === all.length - 1)))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    }
    if (!indicator.includes('-')) value += '\n';
    if (indicator.includes('+')) value = dedented.join('\n') + '\n';
    return value;
  }

  function parseMapping(indent) {
    const result = {};
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (token.indent < indent) break;
      if (token.indent > indent) {
        cursor += 1;
        continue;
      }
      if (token.text === '-' || token.text.startsWith('- ')) break;
      const colon = findColon(token.text);
      if (colon < 0) {
        cursor += 1;
        continue;
      }
      const key = unquote(token.text.slice(0, colon).trim());
      let rest = stripComment(token.text.slice(colon + 1).trim());
      cursor += 1;

      if (rest === '') {
        if (cursor < tokens.length && tokens[cursor].indent > indent) {
          result[key] = parseNode(tokens[cursor].indent);
        } else {
          result[key] = null;
        }
      } else if (BLOCK_RE.test(rest)) {
        result[key] = parseBlockScalar(rest, indent);
      } else if (rest.startsWith('[')) {
        while (cursor < tokens.length && !rest.includes(']')) {
          rest += ` ${tokens[cursor].text}`;
          cursor += 1;
        }
        result[key] = parseInlineArray(rest);
      } else if (rest.startsWith('{')) {
        while (cursor < tokens.length && !rest.includes('}')) {
          rest += ` ${tokens[cursor].text}`;
          cursor += 1;
        }
        result[key] = parseInlineMap(rest);
      } else {
        result[key] = parseScalar(rest);
      }
    }
    return result;
  }

  function parseSequence(indent) {
    const result = [];
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (token.indent !== indent) break;
      if (token.text !== '-' && !token.text.startsWith('- ')) break;
      const rest = token.text.slice(1).trim();
      cursor += 1;
      if (!rest) {
        if (cursor < tokens.length && tokens[cursor].indent > indent) {
          result.push(parseNode(tokens[cursor].indent));
        } else {
          result.push(null);
        }
        continue;
      }
      const colon = findColon(rest);
      if (colon > 0 && !rest.startsWith('[') && !rest.startsWith('{')) {
        const item = {};
        const key = unquote(rest.slice(0, colon).trim());
        const value = rest.slice(colon + 1).trim();
        item[key] = value
          ? parseScalar(value)
          : cursor < tokens.length && tokens[cursor].indent > indent
            ? parseNode(tokens[cursor].indent)
            : null;
        while (cursor < tokens.length && tokens[cursor].indent > indent) {
          if (tokens[cursor].text !== '-' && !tokens[cursor].text.startsWith('- ')) {
            Object.assign(item, parseMapping(tokens[cursor].indent));
          } else {
            break;
          }
        }
        result.push(item);
      } else {
        result.push(parseScalar(rest));
      }
    }
    return result;
  }

  if (tokens.length === 0) return {};
  return parseNode(tokens[0].indent) ?? {};
}

export function splitFrontmatter(raw) {
  const text = String(raw).replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return { hasFrontmatter: false, data: null, rawFrontmatter: '', body: text, error: null };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end < 0) {
    return {
      hasFrontmatter: true,
      data: null,
      rawFrontmatter: lines.slice(1).join('\n'),
      body: '',
      error: 'Frontmatter is missing its closing --- line',
    };
  }
  const rawFrontmatter = lines.slice(1, end).join('\n');
  let data = null;
  let error = null;
  try {
    data = parseYaml(rawFrontmatter);
  } catch (cause) {
    error = `Could not parse YAML frontmatter: ${cause.message}`;
  }
  return {
    hasFrontmatter: true,
    data,
    rawFrontmatter,
    body: lines.slice(end + 1).join('\n'),
    error,
  };
}
