/**
 * fakeip-bridge — host half.
 *
 * Declares the editable row config (fake-IP ranges and logging) and mounts the
 * provider patch implemented in ./fakeip.js. The three fields are volatile:
 * the Settings/Plugins form writes them into the active profile's Cordis patch
 * and Loader commits them into the running plugin without a remount.
 *
 * @module dsh-fakeip-bridge
 */
import z from '@deepseek-ai/schemastery';
import { DEFAULT_IPV4_RANGES, DEFAULT_IPV6_RANGES, apply as applyBridge } from './fakeip.js';

/** Cordis plugin name used by loader diagnostics. */
export const name = 'fakeip-bridge';
/** The web seam whose local fetch provider this plugin instruments. */
export const inject = ['web'];

/**
 * Row config schema. Only volatile fields appear in the configuration form,
 * and edits apply live without reloading the plugin.
 */
export const Config = z.object({
	ipv4Ranges: z.array(z.string()).default([...DEFAULT_IPV4_RANGES]).volatile(),
	ipv6Ranges: z.array(z.string()).default([...DEFAULT_IPV6_RANGES]).volatile(),
	log: z.boolean().default(false).volatile(),
});

/**
 * Mount the provider patch. Config values are re-read on every resolution, so
 * a live edit of the volatile fields takes effect for the next fetch.
 *
 * @param ctx - host plugin context.
 * @param config - resolved row config.
 */
export function apply(ctx, config) {
	applyBridge(ctx, config);
}
