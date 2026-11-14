/**
 * fakeip-bridge — pure host-side logic and the `ctx.web` provider patch.
 *
 * Clash TUN (fake-ip) takes over system DNS: every hostname resolves to a
 * reserved fake address (e.g. 198.18.0.0/15, 2001:2::/48). DSH's local
 * web_fetch provider validates every resolved address before connecting and
 * rejects non-public answers with WEB_BLOCKED_URL, so nearly every fetch fails.
 *
 * The applied resolver wraps the provider's resolveAddresses method:
 *  - the original resolver runs first, and its result (or error) is used as-is
 *    whenever it succeeds or fails for any reason other than "non-public IP";
 *  - only when the original rejection is WEB_BLOCKED_URL/non-public does it
 *    re-resolve through the system resolver and accept the answer, provided
 *    EVERY address is a configured fake-IP range address;
 *  - loopback / private / link-local / IP-literal destinations still fail,
 *    because those resolved addresses are outside the fake-IP ranges.
 *
 * This module has no package imports so it stays directly testable with plain
 * Node, and so the ranged matcher can be rebuilt after a live config edit.
 *
 * @module dsh-fakeip-bridge/fakeip
 */
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** Default IPv4 fake-IP ranges (Clash Verge Rev TUN fake-ip). */
export const DEFAULT_IPV4_RANGES = ['198.18.0.0/15'];
/** Default IPv6 fake-IP ranges (Clash / TUN fake-ip6). */
export const DEFAULT_IPV6_RANGES = ['2001:2::/48', 'fdfe:dcba:9876::/64'];

/** Strip the brackets a URL hostname keeps around an IPv6 literal. */
export function stripIpv6Brackets(host) {
	if (typeof host !== 'string') return host;
	return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/**
 * Read one live config value. A schema field marked `.volatile()` arrives as a
 * stable reference whose get() returns the current immutable snapshot; plain
 * values (unit tests, non-volatile config) pass through unchanged.
 *
 * @param value - a volatile config reference, or a plain value.
 * @returns the current value.
 */
export function readLiveValue(value) {
	if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
		try {
			return value.get();
		} catch {
			return undefined;
		}
	}
	return value;
}

/** Parse an address/prefix list into [address, prefix] tuples; null when unusable. */
export function parseRanges(value, family) {
	if (!Array.isArray(value) || value.length === 0) return null;
	const maxPrefix = family === 'ipv4' ? 32 : 128;
	const ranges = [];
	for (const item of value) {
		if (typeof item !== 'string') return null;
		const text = item.trim();
		if (text.length === 0) return null;
		const slash = text.indexOf('/');
		const address = stripIpv6Brackets(slash === -1 ? text : text.slice(0, slash));
		const prefix = slash === -1 ? maxPrefix : Number(text.slice(slash + 1));
		const parsedFamily = isIP(address);
		if (family === 'ipv4' ? parsedFamily !== 4 : parsedFamily !== 6) return null;
		if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) return null;
		ranges.push([address, prefix]);
	}
	return ranges;
}

/** Build the fake-IP range matcher over IPv4 and IPv6 subnets. */
function buildMatcher(ipv4Ranges, ipv6Ranges) {
	const blockList = new BlockList();
	for (const [address, prefix] of ipv4Ranges ?? []) blockList.addSubnet(address, prefix, 'ipv4');
	for (const [address, prefix] of ipv6Ranges ?? []) blockList.addSubnet(address, prefix, 'ipv6');
	return (address, family) => blockList.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Normalize row config defensively. Invalid values fall back to the defaults
 * that match the verified Clash Verge fake-ip setup on this machine.
 *
 * The returned reader is rebuilt on every resolution, so edits to the volatile
 * row fields take effect without remounting the plugin.
 *
 * @param config - the plugin row config, whose volatile fields are references.
 * @returns the range matcher and a logging helper.
 */
export function normalizeOptions(config) {
	const raw = config !== null && typeof config === 'object' ? config : {};
	const ipv4Ranges = parseRanges(readLiveValue(raw.ipv4Ranges), 'ipv4') ?? parseRanges(DEFAULT_IPV4_RANGES, 'ipv4');
	const ipv6Ranges = parseRanges(readLiveValue(raw.ipv6Ranges), 'ipv6') ?? parseRanges(DEFAULT_IPV6_RANGES, 'ipv6');
	const log = readLiveValue(raw.log) === true;
	return {
		allowed: buildMatcher(ipv4Ranges, ipv6Ranges),
		logLine: (...args) => {
			if (log) console.warn('[fakeip-bridge]', ...args);
		},
	};
}

/** True only for the original resolver's "resolved to a non-public IP" rejection. */
export function isNonPublicBlock(error) {
	return Boolean(error)
		&& error.code === 'WEB_BLOCKED_URL'
		&& typeof error.message === 'string'
		&& /non-public/i.test(error.message);
}

/** dns.lookup(host, { all: true }) that settles early when the request is aborted. */
function lookupAll(hostname, signal) {
	const pending = lookup(hostname, { all: true, order: 'verbatim' });
	if (!signal) return pending;
	if (signal.aborted) return Promise.reject(new Error('aborted'));
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			signal.removeEventListener('abort', onAbort);
			reject(new Error('aborted'));
		};
		signal.addEventListener('abort', onAbort, { once: true });
		pending.then(
			(value) => {
				signal.removeEventListener('abort', onAbort);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener('abort', onAbort);
				reject(error);
			},
		);
	});
}

/**
 * Wrap one resolver. The wrapped function has the same
 * (hostname, signal) => Promise<{address,family}[]> contract as
 * the provider's original publicHttpNetwork.resolve.
 *
 * @param original - the provider's current resolver.
 * @param readOptions - returns the current options; called per rejected attempt
 *   so a live (volatile) config edit is visible immediately.
 * @param dependencies - test seams for the system lookup.
 */
export function createGuardedResolver(original, readOptions, dependencies = {}) {
	const lookupAllImpl = dependencies.lookupAll ?? lookupAll;
	return async function guardedResolve(hostname, signal) {
		try {
			return await original(hostname, signal);
		} catch (error) {
			if (!isNonPublicBlock(error)) throw error;
			const options = readOptions();
			const bare = stripIpv6Brackets(String(hostname));
			// A literal address never gets a second chance: it states the destination.
			if (isIP(bare) !== 0) throw error;
			let resolved;
			try {
				resolved = await lookupAllImpl(bare, signal);
			} catch {
				throw error;
			}
			if (!Array.isArray(resolved) || resolved.length === 0) throw error;
			const addresses = [];
			for (const entry of resolved) {
				const address = entry && entry.address;
				const family = entry && entry.family;
				if ((family !== 4 && family !== 6) || typeof address !== 'string' || isIP(address) !== family) throw error;
				if (!options.allowed(address, family)) throw error;
				addresses.push({ address, family });
			}
			options.logLine?.('allowed fake-IP destination', bare, addresses.map((entry) => entry.address).join(', '));
			return addresses;
		}
	};
}

function patchProvider(provider, readOptions, state) {
	if (!provider || typeof provider !== 'object' || typeof provider.resolveAddresses !== 'function') return;
	if (provider[PATCHED]) return;
	const original = provider.resolveAddresses;
	provider.resolveAddresses = createGuardedResolver(original, readOptions, state.dependencies);
	provider[PATCHED] = { original };
	state.patched.add(provider);
	readOptions().logLine?.('patched fetch provider', provider.id ?? '(unknown)');
}

const PATCHED = Symbol.for('dsh-fakeip-bridge.patched');

function restoreProvider(provider) {
	const patched = provider[PATCHED];
	if (!patched) return;
	provider.resolveAddresses = patched.original;
	delete provider[PATCHED];
}

/**
 * Instrument the local fetch provider. Register everything as an effect so a
 * plugin unload restores the original resolver and registry method.
 *
 * @param ctx - host plugin context.
 * @param config - row config whose volatile fields are read on every resolve.
 */
export function apply(ctx, config) {
	const readOptions = () => normalizeOptions(config);
	const state = { patched: new Set(), dependencies: {} };
	ctx.effect(function* patchFetchProviders() {
		const web = ctx.web;
		const providers = web && web.fetchProviders;
		if (!(providers instanceof Map)) {
			readOptions().logLine?.('ctx.web.fetchProviders is unavailable; plugin stays inert');
			return;
		}
		for (const provider of providers.values()) patchProvider(provider, readOptions, state);
		const hadOwnRegister = Object.prototype.hasOwnProperty.call(web, 'registerFetchProvider');
		const originalRegister = web.registerFetchProvider;
		if (typeof originalRegister === 'function') {
			web.registerFetchProvider = function registerFetchProvider(provider) {
				patchProvider(provider, readOptions, state);
				return originalRegister.call(this, provider);
			};
		}
		yield () => {
			if (typeof originalRegister === 'function') {
				if (hadOwnRegister) web.registerFetchProvider = originalRegister;
				else delete web.registerFetchProvider;
			}
			for (const provider of state.patched) restoreProvider(provider);
			state.patched.clear();
		};
	}, 'fakeip-bridge.patch-fetch-providers');
}
