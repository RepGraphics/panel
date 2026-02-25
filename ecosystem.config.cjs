const { resolve } = require('node:path');

const logsDir = process.env.PM2_LOG_DIR || resolve(__dirname, '.pm2', 'logs');

module.exports = {
  apps: [
    {
      name: 'xyrapanel',
      script: '.output/server/index.mjs',
      cwd: __dirname,
      exec_mode: 'cluster',
      instances: 'max',
      autorestart: true,

      // Resource Management
      max_memory_restart: '1G',

      // Control Flow & Graceful signals
      // Matches the Nitro plugin 'ready' hook for zero-downtime
      kill_timeout: 4000,
      wait_ready: true,
      listen_timeout: 15000,

      // Advanced Stability
      instance_var: 'NODE_APP_INSTANCE',
      max_restarts: 10,
      min_uptime: '15s', // Consider app "up" after 15s
      restart_delay: 2000, // Delay between restarts if it crashes

      // Logging
      // Docker-centric logging configuration
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true, // Prefix logs with timestamp (good for forensics)

      out_file: resolve(logsDir, 'xyrapanel-out.log'),
      error_file: resolve(logsDir, 'xyrapanel-error.log'),
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
