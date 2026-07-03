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
            env: {
                NODE_ENV: 'development',
            },
        },
    ],
};
