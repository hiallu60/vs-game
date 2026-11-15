// Read-only, bounded load check. Run only against your own service.
const base = process.env.BASE_URL || 'http://localhost';
const concurrency = 5, total = 50;
const times = []; let next = 0, failures = 0;
await Promise.all(Array.from({ length:concurrency }, async () => {
  while (next++ < total) {
    const start = performance.now();
    try { const response = await fetch(`${base}/api/topics`, { signal:AbortSignal.timeout(10000) }); await response.arrayBuffer(); if (!response.ok) failures++; }
    catch { failures++; }
    times.push(performance.now() - start);
  }
}));
times.sort((a,b) => a-b);
console.log(JSON.stringify({ requests:times.length, concurrency, failures, average_ms:Math.round(times.reduce((a,b)=>a+b,0)/times.length), p95_ms:Math.round(times[Math.ceil(times.length*.95)-1]) }, null, 2));
process.exitCode = failures ? 1 : 0;
