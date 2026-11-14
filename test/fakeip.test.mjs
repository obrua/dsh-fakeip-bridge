import assert from 'node:assert/strict';
import test from 'node:test';
import { apply, createGuardedResolver, isNonPublicBlock, normalizeOptions, readLiveValue } from '../fakeip.js';

function blockedError(host = 'example.com') {
	const error = new Error(`URL hostname "${host}" resolves to a non-public IP address`);
	error.code = 'WEB_BLOCKED_URL';
	error.name = 'WebError';
	return error;
}

const fakeAnswer = [
	{ address: '198.18.0.22', family: 4 },
	{ address: '2001:2::16', family: 6 },
];

function resolverWith(answer, options = normalizeOptions({})) {
	const calls = [];
	const original = async () => {
		throw blockedError();
	};
	const resolve = createGuardedResolver(original, () => options, {
		lookupAll: async (host) => {
			calls.push(host);
			if (answer instanceof Error) throw answer;
			return answer;
		},
	});
	return { resolve, calls };
}

test('passes a successful original resolution through unchanged', async () => {
	const expected = [{ address: '140.82.112.3', family: 4 }];
	const resolve = createGuardedResolver(async () => expected, () => normalizeOptions({}));
	assert.deepEqual(await resolve('github.com'), expected);
});

test('allows an all-fake-IP answer after a non-public rejection', async () => {
	const { resolve, calls } = resolverWith(fakeAnswer);
	assert.deepEqual(await resolve('github.com'), fakeAnswer);
	assert.deepEqual(calls, ['github.com']);
});

test('rejects loopback answers', async () => {
	const { resolve } = resolverWith([{ address: '127.0.0.1', family: 4 }]);
	await assert.rejects(resolve('localhost'), { code: 'WEB_BLOCKED_URL' });
});

test('rejects private, link-local and mixed answers', async () => {
	for (const answer of [
		[{ address: '192.168.1.10', family: 4 }],
		[{ address: '10.0.0.1', family: 4 }],
		[{ address: '169.254.169.254', family: 4 }],
		[{ address: '198.18.0.22', family: 4 }, { address: '1.1.1.1', family: 4 }],
	]) {
		const { resolve } = resolverWith(answer);
		await assert.rejects(resolve('example.com'), { code: 'WEB_BLOCKED_URL' });
	}
});

test('rejects IP literals without a second DNS lookup', async () => {
	const { resolve, calls } = resolverWith(fakeAnswer);
	await assert.rejects(resolve('127.0.0.1'), { code: 'WEB_BLOCKED_URL' });
	await assert.rejects(resolve('[::1]'), { code: 'WEB_BLOCKED_URL' });
	assert.deepEqual(calls, []);
});

test('lets non-fake-IP unexpected answers fail closed', async () => {
	for (const answer of [[], new Error('boom'), [{ address: '2001:3::1', family: 6 }], [{ address: 'not-an-ip', family: 4 }]]) {
		const { resolve } = resolverWith(answer);
		await assert.rejects(resolve('example.com'), { code: 'WEB_BLOCKED_URL' });
	}
});

test('rethrows unrelated errors untouched', async () => {
	const error = new Error('WEB_PROVIDER_ERROR: no addresses');
	error.code = 'WEB_PROVIDER_ERROR';
	const resolve = createGuardedResolver(async () => {
		throw error;
	}, () => normalizeOptions({}));
	await assert.rejects(resolve('example.com'), (thrown) => thrown === error);
	assert.equal(isNonPublicBlock(error), false);
});

test('range defaults match this machine fake-ip ranges and may be overridden', () => {
	const defaults = normalizeOptions({});
	assert.equal(defaults.allowed('198.18.0.22', 4), true);
	assert.equal(defaults.allowed('198.19.255.255', 4), true);
	assert.equal(defaults.allowed('198.20.0.1', 4), false);
	assert.equal(defaults.allowed('2001:2::16', 6), true);
	assert.equal(defaults.allowed('2001:3::1', 6), false);
	assert.equal(defaults.allowed('fdfe:dcba:9876::1', 6), true);
	assert.equal(defaults.allowed('127.0.0.1', 4), false);
	const narrow = normalizeOptions({ ipv4Ranges: ['198.18.0.0/16'] });
	assert.equal(narrow.allowed('198.18.5.5', 4), true);
	assert.equal(narrow.allowed('198.19.5.5', 4), false);
	const invalid = normalizeOptions({ ipv4Ranges: ['not-an-ip'], ipv6Ranges: [42] });
	assert.equal(invalid.allowed('198.18.0.22', 4), true);
});

test('re-reads volatile config references for every resolution', async () => {
	let ipv4 = ['198.19.0.0/16'];
	let ipv6 = ['2001:3::/48'];
	const config = {
		ipv4Ranges: { get: () => ipv4 },
		ipv6Ranges: { get: () => ipv6 },
		log: { get: () => false },
	};
	assert.deepEqual(readLiveValue(config.ipv4Ranges), ['198.19.0.0/16']);
	const resolve = createGuardedResolver(async () => {
		throw blockedError();
	}, () => normalizeOptions(config), {
		lookupAll: async () => fakeAnswer,
	});
	await assert.rejects(resolve('github.com'), { code: 'WEB_BLOCKED_URL' });
	ipv4 = ['198.18.0.0/15'];
	ipv6 = ['2001:2::/48'];
	assert.deepEqual(await resolve('github.com'), fakeAnswer);
});

function makeCtx() {
	const disposers = [];
	const ctx = {
		effect(generatorFn) {
			const iterator = generatorFn();
			const { value } = iterator.next();
			assert.equal(typeof value, 'function');
			disposers.push(value);
			return () => value();
		},
		web: {
			fetchProviders: new Map(),
			registerFetchProvider(provider) {
				ctx.web.fetchProviders.set(provider.id, provider);
				return () => ctx.web.fetchProviders.delete(provider.id);
			},
		},
	};
	return {
		ctx,
		disposeAll: () => {
			while (disposers.length > 0) disposers.pop()();
		},
	};
}

test('apply patches existing and future providers and removes them on dispose', () => {
	const { ctx, disposeAll } = makeCtx();
	const originalRegister = ctx.web.registerFetchProvider;
	const originalResolver = async () => {
		throw blockedError();
	};
	const provider = { id: 'http', resolveAddresses: originalResolver };
	ctx.web.fetchProviders.set('http', provider);

	apply(ctx, {});
	assert.notEqual(provider.resolveAddresses, originalResolver);
	assert.equal(typeof provider.resolveAddresses, 'function');

	const lateResolver = async () => {
		throw blockedError();
	};
	const lateProvider = { id: 'late', resolveAddresses: lateResolver };
	ctx.web.registerFetchProvider(lateProvider);
	assert.notEqual(lateProvider.resolveAddresses, lateResolver);

	disposeAll();
	assert.equal(provider.resolveAddresses, originalResolver);
	assert.equal(lateProvider.resolveAddresses, lateResolver);
	assert.equal(ctx.web.registerFetchProvider, originalRegister);
});

test('apply stays inert when the web fetch registry has an unexpected shape', () => {
	const ctx = {
		effect(generatorFn) {
			const iterator = generatorFn();
			iterator.next();
		},
		web: {},
	};
	assert.doesNotThrow(() => apply(ctx, {}));
});
