import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { extractLaborAmount, extractPO, extractOE, extractTicketSequence } from '../../shared/ingestShared.ts';

// Standing extraction audit. Run any time to check every extractor for gaps.
//
// For each extractor (labor, PO, OE, ticket_sequence), reports:
//   - candidates: events where a BROAD candidate pattern exists in the raw text
//   - captured:   events where the actual extractor returns a value
//   - gap:        candidates the extractor missed (candidates - captured)
//   - gap_examples: up to 8 examples showing the missed text
//
// The broad pattern is deliberately wider than the extractor — the gap is the
// number that matters. A growing gap means the extractor is silently missing
// data, which is what happened with extractOE (missing 21 bare pipe-delimited
// OEs) and extractLabor (grabbing VPO amounts before the row-by-row audit).
//
// Optional body: { month: "2026-08", source: "google" } — defaults to all
// google-sourced events.

// Broad candidate patterns — wider than the actual extractors
const BROAD = {
  labor: /labor/i,             // any line mentioning "labor"
  po: /\bP\.?O\.?\b[\s#.:-]{0,5}\d{4,}/i,  // "PO" + digits within a few chars
  oe: /\d{7,8}-\d{2}/,         // any 7-8 digit / 2 digit number (labeled or bare)
  ticket_sequence: /win\d*\b/i,  // "win" + optional digits + word boundary
};

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin' && user.role !== 'manager') {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const month = body.month || null;
    const source = body.source || 'google';

    const all = await base44.asServiceRole.entities.CalendarEvents.list('-created_date', 2000);
    let events = all.filter(e => e.source === source);
    if (month) events = events.filter(e => (e.event_date || '').startsWith(month));

    const extractors = {
      labor: { fn: extractLaborAmount, broad: BROAD.labor, label: 'Labor amount' },
      po: { fn: extractPO, broad: BROAD.po, label: 'PO number' },
      oe: { fn: extractOE, broad: BROAD.oe, label: 'OE number' },
      ticket_sequence: { fn: extractTicketSequence, broad: BROAD.ticket_sequence, label: 'Ticket sequence' },
    };

    const report = {};
    for (const [key, { fn, broad, label }] of Object.entries(extractors)) {
      let candidates = 0, captured = 0;
      const gapExamples = [];
      for (const e of events) {
        const text = (e.scope_notes || '') + '\n' + (e.job_name || '');
        const hasCandidate = broad.test(text);
        const extracted = fn(text);
        if (hasCandidate) candidates++;
        if (extracted != null) captured++;
        if (hasCandidate && extracted == null && gapExamples.length < 8) {
          // Show the line that triggered the broad match
          const lines = text.split(/\r?\n/);
          const hitLine = lines.find(l => broad.test(l)) || '';
          gapExamples.push({
            date: e.event_date,
            name: e.job_name,
            missed_text: hitLine.trim().slice(0, 200),
          });
        }
      }
      report[key] = {
        label,
        candidates,
        captured,
        gap: candidates - captured,
        gap_examples: gapExamples,
      };
    }

    return Response.json({
      events_scanned: events.length,
      month: month || 'all',
      source,
      report,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}