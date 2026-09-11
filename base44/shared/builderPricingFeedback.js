import { sourcePricingEnabled, sourcePricePreview } from './amscoSourcePricing.js';

const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const roundMoney = value => Math.round((value + Number.EPSILON) * 100) / 100;

export function pricingIssueMessage(failure = {}) {
  switch (failure.code) {
    case 'large_glass_rules_required':
      return 'This size needs glass construction that is not yet covered by automatic pricing. AMSCO must verify the glass and price; a listed size alone does not confirm its price.';
    case 'glass_construction_override':
      return 'The selected glass thickness needs an AMSCO price check.' + (failure.automatic_glass ? ' Automatic construction for this size is ' + failure.automatic_glass + '.' : '');
    case 'product_profile':
    case 'product_or_option_rules_required':
      return 'Automatic pricing is not yet available for this window type and series. Its configuration and price need an AMSCO check.';
    case 'source_dimensions':
    case 'outside_catalog_size_limits':
      return 'These dimensions are outside the sizes covered by automatic pricing for this product. Check the measurements and measurement type; AMSCO must verify this size and price.';
    case 'configuration_mapping_required':
      return 'The selected product, size or options could not be matched to a priced configuration. Check the window selections; any remaining mismatch needs an AMSCO price check.';
    case 'account_not_qualified':
      return 'Automatic pricing is currently available for the BFS Utah Design account. This dealer or yard needs an AMSCO price check.';
    case 'tempered_rules_required':
      return 'Tempered glass for this product and size needs an AMSCO price check. The non-tempered price cannot be used for the tempered selection.';
    case 'glass_rules_required':
      return 'This glass coating needs an AMSCO price check. Automatic pricing currently covers CozE (LowE).';
    case 'grille_rules_required':
      return 'This grille pattern, color or size needs an AMSCO price check.';
    case 'fixed_construction_override':
      return 'This fixed window has a hardware or screen selection that needs review before it can price automatically.';
    case 'glazing_rules_required':
      return 'The selected glazing method needs an AMSCO price check.';
    case 'operation_rules_required':
    case 'fixed_or_assembly_rules_required':
      return 'The selected window operation or assembly needs an AMSCO price check.';
    case 'source_pricing_unavailable':
      return 'Automatic window pricing is currently unavailable. An AMSCO price check is needed before a window total can be shown.';
    case 'source_pricing_error':
      return 'The automatic price check could not finish. Try the price check again; this window has no confirmed price yet.';
    default:
      if (failure.code?.startsWith('nonstandard_')) {
        const label = { unit_type: 'unit type', number_wide: 'number wide', sash_split: 'sash split', patterned_glass: 'patterned glass', argon: 'thermal gas', elevation: 'installation elevation', super_spacer: 'Super Spacer', capillary_tubes: 'capillary tubes', hardware: 'hardware type', hardware_color: 'hardware finish', screen: 'screen color' }[failure.code.slice(12)];
        if (label) return 'The selected ' + label + ' needs an AMSCO price check.';
      }
      return 'These selected options need an AMSCO price check before a confirmed window price is available.';
  }
}

export function builderPricingIssue(failure = {}) {
  return { code: failure.code || 'amsco_price_check_required', message: pricingIssueMessage(failure),
    ...(failure.automatic_glass ? { automatic_glass: failure.automatic_glass } : {}) };
}

// Read-only assessment of validated specifications. No cached customer/model
// prices, external lookup, queue request or record mutation is accepted here.
export function builderSourcePricingPreview(draft, config) {
  const enabled = sourcePricingEnabled(config);
  const lines = (draft.lines || []).map((line, index) => {
    const base = { index, id: line.id };
    if (!enabled) return { ...base, status: 'native_unavailable', pricing_issue: builderPricingIssue({ code: 'source_pricing_unavailable' }) };
    let failure;
    try {
      const price = sourcePricePreview({ line, settings: draft.settings, onDecline: reason => { failure = reason; } });
      if (price) return { ...base, ...price };
    } catch {
      failure = { code: 'source_pricing_error' };
    }
    return { ...base, status: 'amsco_lookup_needed', pricing_issue: builderPricingIssue(failure) };
  });
  const priced = lines.filter(line => line.status === 'priced');
  const ready = lines.length > 0 && priced.length === lines.length;
  const subtotal = priced.length ? roundMoney(priced.reduce((sum, line) => sum + line.line_totals.customer, 0)) : null;
  return { ready, lines, total: ready ? subtotal : null, priced_subtotal: subtotal, currency: 'USD',
    missing_count: lines.length - priced.length, calculation_count: 0, needs_details_count: 0, pending: false, questions: [] };
}

// The proposed draft is assessed again after intake validation. This text and
// the displayed prices come from that assessment, never from the model summary.
export function builderPricingFeedback(preview) {
  if (!preview.lines.length) return '';
  const details = preview.lines.slice(0, 12).map(line => {
    const label = 'Line ' + (line.index + 1) * 100;
    if (line.status !== 'priced') return label + ': ' + line.pricing_issue.message;
    return label + ': ' + money(line.unit_prices.customer) + ' per window; ' + money(line.line_totals.customer) + ' for this quantity.';
  });
  if (preview.lines.length > 12) details.push('See the line items below for the remaining ' + (preview.lines.length - 12) + ' price checks.');
  if (preview.ready) details.push('Window total: ' + money(preview.total) + '. Installation is calculated separately.');
  else if (preview.priced_subtotal !== null) details.push('Priced windows subtotal: ' + money(preview.priced_subtotal) + '. The unpriced lines need an AMSCO check before a complete window total is available.');
  return details.join('\n');
}
