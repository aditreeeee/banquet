/**
 * Cross-worker cache invalidation for PM2 cluster mode.
 *
 * The app runs under `pm2 start ecosystem.config.js` with `instances:'max'`
 * (see ecosystem.config.js) — every NodeCache instance (dashboard, permission,
 * scope, etc.) lives in its own worker process, so invalidating a key in the
 * worker that handled a write leaves every *other* worker still serving that
 * stale value until its own TTL expires. PM2's God daemon rebroadcasts any
 * `process:msg`-typed message sent via `process.send()` to every instance of
 * the same app, so this uses that (already-available, no new dependency)
 * channel to fan an invalidation out to all workers.
 *
 * Falls back to a no-op broadcast when not running under PM2/cluster
 * (`process.send` is undefined) — invalidation still happens locally via the
 * caller's own cache.del(), which is all that's needed in a single process.
 */
'use strict';

const logger = require('./logger');

const listeners = new Map();

if (typeof process.send === 'function') {
    process.on('message', (packet) => {
        if (!packet || packet.type !== 'process:msg' || !packet.topic) return;
        const handler = listeners.get(packet.topic);
        if (!handler) return;
        try {
            handler(packet.data);
        } catch (err) {
            logger.error('Cluster cache invalidation handler failed', { topic: packet.topic, error: err.message });
        }
    });
}

/**
 * Register the local invalidation logic for a topic — called when this or a
 * sibling worker broadcasts that topic.
 */
const onInvalidate = (topic, handler) => {
    listeners.set(topic, handler);
};

/**
 * Tell every other worker (not this one — the caller already invalidated its
 * own cache directly) to run their handler for this topic.
 */
const broadcastInvalidate = (topic, data) => {
    if (typeof process.send === 'function') {
        process.send({ type: 'process:msg', topic, data });
    }
};

module.exports = { onInvalidate, broadcastInvalidate };
