// Backfilling existing calendar records is deliberately disabled. New events
// are handled during sync; historical copies need a separate owner decision.
export default async function() {
  return Response.json({ error: 'Historical attachment rehosting is not enabled.' }, { status: 403 });
}
