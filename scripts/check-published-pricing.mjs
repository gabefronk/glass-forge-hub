// Public routing smoke test: no credentials, quote changes, or pricing side effects.
// A protected handler must answer 401. This catches missing published workers;
// a signed-in browser pricing check is still required after publishing.
const appId = '6a7f0d7a4a5f825c724273e9';
const origin = 'https://gfglassforge.com';
const probes = [
  ['windowQuoteBuilder', { action: 'assistant_status' }],
  ['windowQuotes', { action: 'list' }],
];
const results = await Promise.all(probes.map(async ([name, payload]) => {
  try {
    const response = await fetch(`${origin}/api/apps/${appId}/functions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Base44-Functions-Version': 'prod' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => ({}));
    const ok = response.status === 401 && body.error === 'Sign in required';
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: HTTP ${response.status}${body.detail === 'user worker not found' ? ' — published worker is missing' : ''}`);
    return ok;
  } catch (error) {
    console.error(`FAIL ${name}: ${error.name === 'TimeoutError' ? 'request timed out' : 'request failed'}`);
    return false;
  }
}));
if (results.some(ok => !ok)) process.exitCode = 1;
else console.log('Published pricing routes respond. Verify a priced window while signed in before declaring the release complete.');
