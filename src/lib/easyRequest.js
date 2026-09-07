import { buildQuotePlan } from './amscoQuotePlan.js';

// A selectable recipe, not an account default. The request must explicitly
// confirm this exact revision and provide finance, frame color and glass.
const BASE_OPTIONS = Object.freeze({
  series: 'Studio 1 3/8 inch Fin Setback', unit_type: 'Complete Unit',
  glass_thickness: 'SS over SS', glazing_method: '3/4 inch Insulated Glass',
  elevation: '2501 to 6500', tempered: false, argon: false, super_spacer: false,
  capillary_tubes: false, grilles: 'None', number_wide: 1, hardware: 'Cam Latch'
});
export const STANDARD_STUDIO_PROFILE = Object.freeze({
  id: 'studio-sh-standard', revision: 1, name: 'Studio Single Hung standard configuration',
  style: 'Studio Single Hung', options: BASE_OPTIONS, match_interior_colors: true,
  description: 'Studio 1 3/8 inch Fin Setback; one-wide Complete Unit; SS over SS; 3/4 inch insulated; elevation 2501 to 6500; no tempered glass, argon, Super Spacer, capillary tubes or grilles; Cam Latch; hardware and screen match the White or Taupe interior. Color, CozE LowE, dimensions, account, yard and gross margin are chosen separately.'
});
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const text = value => typeof value === 'string' ? value.trim() : '';
const norm = value => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const has = value => value !== undefined && value !== null && value !== '';
const add = (issues, code, path, message) => issues.push({ code, path, message });
const same = (a, b) => typeof a === 'string' && typeof b === 'string' ? norm(a).replace(/^studio(?=singlehung)/, '') === norm(b).replace(/^studio(?=singlehung)/, '') : a === b;

function modifiers(raw, path) {
  let rest = text(raw), out = { options: {} };
  const issues = [];
  const room = rest.match(/\broom\s*[:=]\s*(.+)$/i);
  if (room) {
    const value = room[1].trim().replace(/^(["'])(.*)\1$/, '$2');
    if (!value || value.length > 250) add(issues, 'invalid_room', path + '.room', 'Use a room label of at most 250 characters.');
    else out.room = value;
    rest = rest.slice(0, room.index).trim();
  }
  const take = (pattern, apply) => {
    const match = rest.match(pattern);
    if (!match) return false;
    apply(match);rest = rest.slice(match[0].length).trim();return true;
  };
  const assign = (target, key, value) => {
    if (Object.hasOwn(target, key) && !same(target[key], value)) add(issues, 'conflicting_text', path + '.' + key, 'The written request contains conflicting ' + key.replaceAll('_', ' ') + ' choices.');
    else target[key] = value;
  };
  while (rest) {
    if (take(/^(?:studio\s+)?single[ -]?hung\b|^sh\b/i, () => assign(out, 'style', 'Studio Single Hung'))) continue;
    if (take(/^black\s+(?:exterior|outside)\s*(?:\/|and|with)?\s*white\s+(?:interior|inside)\b/i, () => assign(out.options, 'color', 'Black outside / White inside'))) continue;
    if (take(/^(white|taupe|black)\b/i, match => assign(out.options, 'color', match[1][0].toUpperCase() + match[1].slice(1).toLowerCase()))) continue;
    if (take(/^(?:coze\s*\(\s*low[ -]?e\s*\)|coze(?:\s+low[ -]?e)?|low[ -]?e)(?=\s|$)/i, () => assign(out.options, 'glass', 'CozE (LowE)'))) continue;
    if (take(/^(?:no\s+low[ -]?e|clear\s+glass)\b/i, () => assign(out.options, 'glass', 'Clear'))) continue;
    if (take(/^(?:not\s+tempered|no\s+tempered|untempered)\b/i, () => assign(out.options, 'tempered', false))) continue;
    if (take(/^tempered\b/i, () => assign(out.options, 'tempered', true))) continue;
    if (take(/^(no\s+)?(argon|super\s+spacer|capillary\s+tubes)\b/i, match => assign(out.options, norm(match[2]) === 'superspacer' ? 'super_spacer' : norm(match[2]) === 'capillarytubes' ? 'capillary_tubes' : 'argon', !match[1]))) continue;
    if (take(/^no\s+grilles\b/i, () => assign(out.options, 'grilles', 'None'))) continue;
    if (take(/^(call|frame|rough\s+opening)(?:\s+(?:size|dimensions))?\b/i, match => assign(out, 'dimension_basis', norm(match[1]) === 'roughopening' ? 'rough_opening' : norm(match[1])))) continue;
    if (take(/^(?:inches|inch|in)\b/i, () => assign(out, 'units', 'in'))) continue;
    if (take(/^(?:windows?|units?|with)\b/i, () => {})) continue;
    add(issues, 'unparsed_text', path, 'Review the unrecognized written detail: "' + rest.slice(0, 180) + '". It has not been applied to the quote.');
    break;
  }
  return { ...out, issues };
}

/** Bounded grammar: qty + four-digit feet/inches code or decimal width x height,
 * with explicit context for dimension basis/units. Unknown fragments block. */
export function parseSimpleSchedule(message, context = {}) {
  const issues = [], lines = [], global = { options: {} };
  if (typeof message !== 'string' || message.length > 18000) return { ok: false, lines, global, issues: [{ code: 'invalid_message', path: 'message', message: 'Provide a written schedule of at most 18000 characters.' }], used_shorthand: false };
  let raw = message.trim().replace(/^(?:(?:please\s+)?(?:quote|price)|i\s+(?:need|want))\s+/i, '').replace(/[.!]\s*$/, '');
  if (!raw) return { ok: true, lines, global, issues, used_shorthand: false };
  const clauses = raw.split(/\s*(?:[,;\n]+|\s+(?:and|&)\s+(?=(?:qty\s*[:=]?\s*)?\d))\s*/i).filter(Boolean);
  let usedShorthand = false;
  for (let index = 0; index < clauses.length; index++) {
    let clause = clauses[index].trim(), path = 'message[' + index + ']';
    const quantity = clause.match(/^(?:qty\s*[:=]?\s*)?(\d+)\s*(?:x\s*)?(?=\s|\d)/i);
    if (!quantity) {
      const parsed = modifiers(clause.replace(/^all(?:\s+windows)?\s+/i, ''), path);
      issues.push(...parsed.issues);
      for (const [key, value] of Object.entries(parsed.options)) {
        if (Object.hasOwn(global.options, key) && !same(global.options[key], value)) add(issues, 'conflicting_text', path, 'Written global choices conflict.');
        else global.options[key] = value;
      }
      for (const key of ['style', 'dimension_basis', 'units']) if (parsed[key]) global[key] = parsed[key];
      if (parsed.room) add(issues, 'room_without_line', path, 'Attach the room label to a window line.');
      continue;
    }
    clause = clause.slice(quantity[0].length).trim();
    let basis;
    const prefix = clause.match(/^(call|frame|rough\s+opening)(?:\s+size)?\s+/i);
    if (prefix) { basis = norm(prefix[1]) === 'roughopening' ? 'rough_opening' : norm(prefix[1]);clause = clause.slice(prefix[0].length); }
    let width, height, numeric = clause.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?!\d)/i);
    if (numeric) { width = Number(numeric[1]);height = Number(numeric[2]);clause = clause.slice(numeric[0].length); }
    else {
      const code = clause.match(/^(\d)(\d)(\d)(\d)(?!\d)/);
      if (!code) { add(issues, 'unparsed_dimensions', path, 'Use explicit quantity plus a four-digit size code (2 3050) or dimensions (2 36x60).');continue; }
      width = Number(code[1]) * 12 + Number(code[2]);height = Number(code[3]) * 12 + Number(code[4]);
      clause = clause.slice(code[0].length);usedShorthand = true;
    }
    const parsed = modifiers(clause, path);issues.push(...parsed.issues);
    if (basis && parsed.dimension_basis && basis !== parsed.dimension_basis) add(issues, 'conflicting_text', path, 'Written dimension bases conflict.');
    lines.push({ qty: Number(quantity[1]), width, height,
      ...(parsed.style ? { style: parsed.style } : {}),
      ...(basis || parsed.dimension_basis || context.dimension_basis ? { dimension_basis: basis || parsed.dimension_basis || context.dimension_basis } : {}),
      ...(parsed.units || context.units ? { units: parsed.units || context.units } : {}),
      ...(parsed.room !== undefined ? { room: parsed.room } : {}), options: parsed.options });
  }
  for (const line of lines) {
    for (const key of ['style', 'dimension_basis', 'units']) if (!line[key] && global[key]) line[key] = global[key];
    line.options = { ...global.options, ...line.options };
  }
  return { ok: issues.length === 0, lines, global, issues, used_shorthand: usedShorthand };
}

function selectedColors(options, settings) {
  const source = has(options.color) || has(options.exterior_color) || has(options.interior_color) ? options : settings;
  if (has(source.exterior_color) || has(source.interior_color)) {
    if (norm(source.exterior_color) === 'white' && norm(source.interior_color) === 'white') return 'White';
    if (norm(source.exterior_color) === 'taupe' && norm(source.interior_color) === 'taupe') return 'Taupe';
    return null;
  }
  return { white: 'White', whitebothsides: 'White', taupe: 'Taupe', taupebothsides: 'Taupe' }[norm(source.color)] || null;
}
function normalizeLowE(settings, issues) {
  if (!Object.hasOwn(settings, 'low_e')) return;
  const value = settings.low_e;delete settings.low_e;
  if (typeof value !== 'boolean') { add(issues, 'missing_glass', 'settings.glass', 'Choose CozE (LowE) or specify another glass for review.');return; }
  const glass = value ? 'CozE (LowE)' : 'Clear';
  if (has(settings.glass) && !same(settings.glass, glass)) add(issues, 'conflicting_glass', 'settings.glass', 'The LowE selection and glass description disagree.');
  else settings.glass = glass;
}

/** Pure preparation. Caller must preserve accepted identity/revision, persist
 * returned settings/lines, then freeze/hash the accepted plan server-side. */
export function normalizeEasyRequest(input, { preset = STANDARD_STUDIO_PROFILE } = {}) {
  if (!object(input)) return { ok: false, status: 'needs_details', routing: 'clarification', quote: input, issues: [{ code: 'invalid_request', path: '', message: 'Provide a quote request.' }], questions: ['Provide a quote request.'], preview: [] };
  const quote = clone(input), issues = [], settings = object(quote.settings) ? quote.settings : {};
  if (quote.settings !== undefined && !object(quote.settings)) add(issues, 'invalid_settings', 'settings', 'Supply structured account and quote settings.');
  if (Array.isArray(quote.lines)) quote.lines.forEach((line, index) => {
    if (object(line) && line.options !== undefined && !object(line.options)) add(issues, 'invalid_options', 'lines[' + index + '].options', 'Window options must be a structured object.');
  });
  quote.settings = settings;normalizeLowE(settings, issues);
  const easy = object(quote.source?.easy_request) ? quote.source.easy_request : {};
  // Legacy checked schedules already use the complete explicit contract. Their
  // historical prose is not a new easy-request instruction or profile consent.
  const explicit = buildQuotePlan(quote);
  if (!Object.hasOwn(quote.source || {}, 'easy_request') && explicit.ok && !issues.length) return {
    ok: true, status: 'ready_to_queue', routing: 'supported', quote, plan: explicit.plan,
    issues: [], questions: [], preview: clone(explicit.plan.lines), profile_applied: false, message_interpreted: false
  };
  const confirmed = easy.confirmed === true && easy.profile_id === preset.id && easy.profile_revision === preset.revision;
  const userMessages = Array.isArray(quote.conversation) ? quote.conversation.filter(message => message?.role === 'user' && typeof message.content === 'string') : [];
  const currentMessage = userMessages.filter(message => message.revision === quote.input_revision).at(-1);
  // Details edits increment the request revision without adding a new message.
  // Never reinterpret older prose against a newly edited structured schedule.
  const initialMessage = quote.input_revision === 1 ? userMessages.filter(message => message.revision === undefined || message.revision === 1).at(-1)?.content ?? quote.request_text ?? '' : '';
  const message = typeof quote.message === 'string' ? quote.message : currentMessage?.content ?? initialMessage;
  const parsed = parseSimpleSchedule(message, { dimension_basis: easy.dimension_basis, units: easy.units });
  issues.push(...parsed.issues);
  // A short clarification must not erase an earlier unrecognized requirement
  // after partially parsed rows were saved. An explicit Details edit replaces
  // the schedule; its history revision marks which older prose is superseded.
  const lastEditedRevision = Math.max(0, ...(Array.isArray(quote.history) ? quote.history.filter(item => item?.reason === 'edited' && Number.isSafeInteger(item.revision)).map(item => item.revision) : []));
  for (const earlier of userMessages) {
    const revision = earlier.revision ?? 1;
    if (revision <= lastEditedRevision || revision >= quote.input_revision) continue;
    const previous = parseSimpleSchedule(earlier.content, { dimension_basis: easy.dimension_basis, units: easy.units });
    for (const item of previous.issues) add(issues, 'unresolved_written_detail', 'conversation.revision[' + revision + '].' + item.path, 'An earlier written requirement still needs review: ' + item.message + ' Correct the request details before quoting.');
  }
  for (const [key, value] of Object.entries(parsed.global.options)) {
    if (has(settings[key]) && !same(settings[key], value)) add(issues, 'conflicting_request', 'settings.' + key, 'The written choice and selected ' + key.replaceAll('_', ' ') + ' disagree.');
    else settings[key] = value;
  }
  const structured = Array.isArray(quote.lines) && quote.lines.length > 0;
  let lines = structured ? quote.lines : parsed.lines;
  if (structured && parsed.lines.length) {
    if (lines.length !== parsed.lines.length) add(issues, 'conflicting_schedule', 'lines', 'The written schedule and structured schedule have different line counts; confirm which to use.');
    else lines = lines.map((line, index) => {
      if (!object(line)) return line;
      const written = parsed.lines[index];
      for (const key of ['qty', 'width', 'height', 'style', 'dimension_basis', 'units', 'room']) if (has(written[key]) && has(line[key]) && !same(written[key], line[key])) add(issues, 'conflicting_schedule', 'lines[' + index + '].' + key, 'The written and structured ' + key.replaceAll('_', ' ') + ' disagree.');
      for (const [key, value] of Object.entries(written.options)) if (has(line.options?.[key]) && !same(line.options[key], value)) add(issues, 'conflicting_schedule', 'lines[' + index + '].options.' + key, 'Written and structured window options disagree.');
      return { ...written, ...line, options: { ...written.options, ...(object(line.options) ? line.options : {}) } };
    });
  }
  quote.lines = lines.map(line => object(line) ? { ...line,
    ...(!has(line.dimension_basis) && easy.dimension_basis ? { dimension_basis: easy.dimension_basis } : {}),
    ...(!has(line.units) && easy.units ? { units: easy.units } : {}) } : line);

  // Complete explicit structured options require no preset and may use a
  // separately supported color path. They are still checked by the real planner.
  let checked = buildQuotePlan(quote), profileApplied = false;
  if (!checked.ok) {
    if (confirmed) {
      profileApplied = true;
      quote.lines = quote.lines.map((line, index) => {
        if (!object(line)) return line;
        const supplied = object(line.options) ? line.options : {};
        const explicitSettings = Object.fromEntries(Object.keys(preset.options).filter(key => Object.hasOwn(settings, key)).map(key => [key, settings[key]]));
        const options = { ...clone(preset.options), ...explicitSettings, ...supplied };
        const interior = selectedColors(supplied, settings);
        const hasAnyColor = [supplied.color, supplied.exterior_color, supplied.interior_color, settings.color, settings.exterior_color, settings.interior_color].some(has);
        if (hasAnyColor && !interior) add(issues, 'profile_color_review', 'lines[' + index + '].options.color', 'The standard profile applies only to White/White or Taupe/Taupe. Black, mixed or custom configurations need complete explicit options and review.');
        if (preset.match_interior_colors === true && interior) {
          if (!Object.hasOwn(supplied, 'hardware_color') && !has(settings.hardware_color)) options.hardware_color = interior;
          if (!Object.hasOwn(supplied, 'screen') && !has(settings.screen)) options.screen = interior;
        }
        return { ...line, style: has(line.style) ? line.style : preset.style, options };
      });
      checked = buildQuotePlan(quote);
    } else {
      add(issues, 'profile_confirmation_required', 'source.easy_request', 'Review and confirm the Studio standard configuration for this request, or supply every required option explicitly.');
    }
  }
  if (parsed.used_shorthand && !confirmed) add(issues, 'shorthand_confirmation_required', 'source.easy_request', 'Confirm the size-code interpretation and standard profile before using shorthand sizes.');
  if (!checked.ok) issues.push(...checked.issues);
  const unique = [...new Map(issues.map(item => [item.code + ':' + item.path + ':' + item.message, item])).values()];
  const ok = unique.length === 0 && checked.ok;
  // Confirmed matching hardware/screens depend on the missing frame color.
  // Ask for that one choice without weakening the actual planner issues.
  const questionIssues = unique.filter(item => {
    const match = item.path.match(/^lines\[(\d+)\]\.options\.(hardware_color|screen)$/);
    if (!confirmed || !profileApplied || !preset.match_interior_colors || item.code !== 'missing_option' || !match) return true;
    const base = 'lines[' + match[1] + '].options';
    const line = quote.lines[Number(match[1])];
    return !unique.some(other => other.code === 'missing_option' && other.path === base + '.color') || Object.hasOwn(line?.options || {}, match[2]) || Object.hasOwn(settings, match[2]);
  });
  const allQuestions = [...new Set(questionIssues.map(item => confirmed && profileApplied && item.code === 'missing_option' && item.path.endsWith('.color') ? 'Which color should the windows with no color use: White or Taupe?' : item.message))];
  const questions = allQuestions.length > 30 ? [...allQuestions.slice(0, 29), 'Additional line-level issues are shown in the schedule preview; resolve them before quoting.'] : allQuestions;
  return {
    ok, status: ok ? 'ready_to_queue' : 'needs_details', routing: ok ? 'supported' : unique.some(item => /unsupported|unparsed|conflicting|review|unresolved/.test(item.code)) ? 'review' : 'clarification',
    quote, ...(ok ? { plan: checked.plan } : {}), issues: unique, questions,
    preview: quote.lines.map(line => object(line) ? Object.fromEntries(['mark', 'room', 'qty', 'width', 'height', 'units', 'dimension_basis', 'style', 'options'].filter(key => Object.hasOwn(line, key)).map(key => [key, clone(line[key])])) : line), profile_applied: profileApplied, message_interpreted: true,
    ...(profileApplied ? { profile: { id: preset.id, revision: preset.revision, description: preset.description } } : {})
  };
}
