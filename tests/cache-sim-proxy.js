// Test helper: a badly configured page cache in front of the test site.
// - Caches every GET answered with 200, keyed by URL only (ignores cookies).
// - Serves the cached copy unless the request says "Cache-Control: no-cache" or "Pragma: no-cache".
// - Adds NO cache headers (no X-Cache, no Age), so nothing gives it away.
// Usage: node cache-sim-proxy.js <listen-port> <target-port>
const http = require('http');
const [listenPort, targetPort] = process.argv.slice(2).map(Number);
const cache = new Map();

http.createServer((req, res) => {
	const bypass = /no-cache/i.test(req.headers['cache-control'] || '') || /no-cache/i.test(req.headers.pragma || '');
	if (req.method === 'GET' && !bypass && cache.has(req.url)) {
		const hit = cache.get(req.url);
		res.writeHead(200, hit.headers);
		res.end(hit.body);
		return;
	}
	const up = http.request({ host: '127.0.0.1', port: targetPort, path: req.url, method: req.method, headers: req.headers }, (r) => {
		const chunks = [];
		r.on('data', (c) => chunks.push(c));
		r.on('end', () => {
			const body = Buffer.concat(chunks);
			const headers = { ...r.headers };
			delete headers['set-cookie'];
			delete headers['transfer-encoding'];
			if (req.method === 'GET' && r.statusCode === 200) {
				cache.set(req.url, { headers, body });
			}
			res.writeHead(r.statusCode, r.headers);
			res.end(body);
		});
	});
	up.on('error', () => { res.writeHead(502); res.end(); });
	req.pipe(up);
}).listen(listenPort, '127.0.0.1');
