// Protects the NEX passwords stored in the account database. The key is PN_ACT_CONFIG_NEX_PASSWORD_KEY.
// Values without the prefix are older plain-text ones: they are read as they are and protected the next time they are written.
const crypto = require('node:crypto');

const PREFIX = 'enc:v1:';

function key() {
	const hex = process.env.PN_ACT_CONFIG_NEX_PASSWORD_KEY || '';
	if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('PN_ACT_CONFIG_NEX_PASSWORD_KEY must be 64 hex characters');
	return Buffer.from(hex, 'hex');
}

function encrypt(plain) {
	if (typeof plain !== 'string' || plain.startsWith(PREFIX)) return plain;
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
	const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	return PREFIX + [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64')).join(':');
}

function decrypt(stored) {
	if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) return stored;
	const [iv, tag, data] = stored.slice(PREFIX.length).split(':').map((part) => Buffer.from(part, 'base64'));
	const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, PREFIX };
