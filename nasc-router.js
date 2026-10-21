// NASC front for 3DS.
//   POST /ac        titles listed in the local Mongo `servers` collection -> local Pretendo account server;
//                   every other title -> real nasc.pretendo.cc (passthrough)
//   POST /protarium-connect/register  store a console's real Pretendo NEX pid + password locally (see below)
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { MongoClient } = require('mongodb'); // reuse the one installed with the Pretendo account server

const PORT = Number(process.env.NASC_ROUTER_PORT || 7070);
const LOCAL = process.env.NASC_LOCAL_URL || 'http://127.0.0.1:7071';
// Host the account server's NASC router answers to (its PN_ACT_CONFIG_DOMAINS_NASC)
const LOCAL_HOST = process.env.NASC_LOCAL_HOST;
if (!LOCAL_HOST) throw new Error('NASC_LOCAL_HOST must be set to the account server NASC domain');
const REMOTE = 'https://nasc.pretendo.cc';

const b64d = (s) => Buffer.from(s.replace(/\*/g, '=').replace(/\./g, '+').replace(/-/g, '/'), 'base64').toString();

let ours = new Set();
const mongo = new MongoClient(process.env.PN_ACT_CONFIG_MONGO_CONNECTION_STRING);
async function refresh() {
	try {
		const docs = await mongo.db().collection('servers').find({}, { projection: { title_ids: 1 } }).toArray();
		ours = new Set(docs.flatMap((d) => d.title_ids || []).map((t) => t.toLowerCase()));
	} catch (e) { console.error('refresh failed', e.message); } // keep the previous set
}

// Same friend code derivation as the Pretendo account server (middleware/nasc.ts)
function friendCode(pid) {
	const buf = Buffer.alloc(4);
	buf.writeUInt32LE(pid);
	const checksum = crypto.createHash('sha1').update(buf).digest()[0] >> 1;
	return parseInt(checksum.toString(16) + pid.toString(16), 16).toString().padStart(12, '0').match(/.{1,4}/g).join('-');
}

// Protarium Connect (3DS homebrew) POSTs form fields `pid` (decimal) and `password` (FRD_GetMyPassword, the console's
// real Pretendo NEX secret) to https://<your account domain>/protarium-connect/register.
// First write wins: an existing local account is never overwritten with a different password.
// There is no console certificate in this request, so nothing proves the caller owns the pid.
const hits = new Map(); // ip -> [count, windowStart]
function limited(ip) {
	const now = Date.now();
	const h = hits.get(ip);
	if (!h || now - h[1] > 3600000) { hits.set(ip, [1, now]); return false; }
	return ++h[0] > 20;
}

async function register(params, ip) {
	const pid = Number(params.get('pid'));
	const password = params.get('password') || '';
	if (!Number.isInteger(pid) || pid < 1 || pid > 1799999999 || !password || password.length > 64) return [400, { error: 'bad request' }];
	if (limited(ip)) return [429, { error: 'too many requests' }];

	const nexaccounts = mongo.db().collection('nexaccounts');
	const existing = await nexaccounts.findOne({ pid }, { projection: { password: 1 } });
	if (existing) return existing.password === password ? [200, { ok: true, pid }] : [409, { error: 'pid already registered' }];

	await nexaccounts.insertOne({ pid, password, device_type: '3ds', access_level: 0, server_access_level: 'prod', friend_code: friendCode(pid), __v: 0 });
	console.log(new Date().toISOString(), 'REGISTER pid', pid);
	return [200, { ok: true, pid }];
}

// node's fetch refuses to send a custom Host header, and the account server picks its router by Host, so use http(s).request
function relay(target, method, headers, body) {
	return new Promise((resolve, reject) => {
		const url = new URL(target);
		const lib = url.protocol === 'https:' ? https : http;
		const outgoing = lib.request(url, { method, headers: { ...headers, 'content-length': body.length }, timeout: 15000 }, (res) => {
			const chunks = [];
			res.on('data', (c) => chunks.push(c));
			res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || 'text/plain', data: Buffer.concat(chunks) }));
		});
		outgoing.on('timeout', () => outgoing.destroy(new Error('upstream timed out')));
		outgoing.on('error', reject);
		outgoing.end(body);
	});
}

http.createServer((req, res) => {
	const chunks = [];
	let size = 0;
	req.on('data', (c) => { size += c.length; if (size > 65536) req.destroy(); else chunks.push(c); });
	req.on('end', async () => {
		const body = Buffer.concat(chunks);
		const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;
		let params = new URLSearchParams();
		try { params = new URLSearchParams(body.toString()); } catch {}

		if (req.method === 'POST' && req.url.split('?')[0] === '/protarium-connect/register') {
			let out;
			try { out = await register(params, ip); } catch (e) { console.error('register failed', e.message); out = [500, { error: 'internal' }]; }
			res.writeHead(out[0], { 'content-type': 'application/json' });
			res.end(JSON.stringify(out[1]));
			return;
		}

		let titleId = '';
		try { titleId = b64d(params.get('titleid') || '').toLowerCase(); } catch {}
		const local = ours.has(titleId);
		const headers = {
			'content-type': req.headers['content-type'] || 'application/x-www-form-urlencoded',
			'x-forwarded-for': req.headers['x-forwarded-for'] || ip,
			'x-real-ip': ip,
			host: local ? LOCAL_HOST : 'nasc.pretendo.cc'
		};
		try {
			const r = await relay((local ? LOCAL : REMOTE) + req.url, req.method, headers, body);
			res.writeHead(r.status, { 'content-type': r.type });
			res.end(r.data);
		} catch (e) {
			console.error(local ? 'local' : 'remote', titleId, e.message);
			res.writeHead(502).end();
		}
		console.log(new Date().toISOString(), titleId, local ? 'LOCAL' : 'PRETENDO', req.url);
	});
}).listen(PORT, '127.0.0.1', async () => { await refresh(); setInterval(refresh, 60000); console.log('nasc-router up, ours:', ours.size); });
