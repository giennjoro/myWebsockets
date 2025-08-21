module.exports = {
  apps: [{
    name: 'websockets-app',
    script: 'index.js',
    cwd: '/var/www/myWebsockets',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env_production: {
      NODE_ENV: 'production',
      PORT: 3001,
      DASHBOARD_USERNAME: 'writersAdmin',
      DASHBOARD_PASSWORD: '@Writer12'
    },
    error_file: '/var/log/pm2/websockets-error.log',
    out_file: '/var/log/pm2/websockets-out.log',
    log_file: '/var/log/pm2/websockets-combined.log'
  }]
};