module.exports = {
    apps: [
        {
            name:            'banquetpro-api',
            script:          'server.js',
            cwd:             __dirname,
            instances:       1,
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
