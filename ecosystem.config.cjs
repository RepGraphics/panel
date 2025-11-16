const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || 'production',
  PORT: process.env.PORT || process.env.NITRO_PORT || 3000,
  HOST: process.env.HOST || process.env.NITRO_HOST || '0.0.0.0',
}

module.exports = {
  apps: [{
    name: 'xyrapanel',
    script: '.output/server/index.mjs',
    instances: 'max',
    exec_mode: 'cluster',
    env,
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_memory_restart: '1G',
    watch: false,
  }],
}
