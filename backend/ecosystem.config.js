module.exports = {
    apps: [
        {
            name:            'banquetpro-api',
            script:          'server.js',
            cwd:             __dirname,
            // Cluster mode spreads load across every CPU core instead of a
            // single Node process — needed for the concurrency this app
            // targets. Trade-off: dashboard.service.js's in-memory NodeCache
            // is per-worker, so invalidateDashboardCache() on a write only
            // clears that worker's copy — other workers can serve dashboard
            // data up to its 5-minute TTL stale. Acceptable for now (same
            // cache already had a TTL-bounded staleness window pre-cluster);
            // move it to a shared store (e.g. Redis) if that window matters.
            instances:       'max',
            exec_mode:       'cluster',
            autorestart:     true,
            watch:           false,
            max_restarts:    10,
            min_uptime:      '10s',
            restart_delay:   2000,
            // Default env is production-safe — `pm2 start ecosystem.config.js`
            // with no --env flag must never silently run in development mode
            // (that disables the secure-cookie flag and widens CORS). Pass
            // `--env development` explicitly for local/dev use instead.
            env: {
                NODE_ENV: 'production',
            },
            env_production: {
                NODE_ENV: 'production',
            },
            env_development: {
                NODE_ENV: 'development',
            },
        },
    ],
};
