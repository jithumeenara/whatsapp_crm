/**
 * PM2 process file — EXAMPLE. Copy to the app folder as ecosystem.config.cjs
 * (it is not read from docs/), adjust `cwd`, then as the app user (never root):
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   sudo env PATH=$PATH pm2 startup systemd -u crm --hp /home/crm   # once
 *   pm2 install pm2-logrotate                                         # once, see below
 *
 * Secrets do NOT go in this file. They stay in the app folder's .env
 * (chmod 600, owned by the app user), which Next loads at start-up. This
 * file is often copied, pasted into chats and committed; .env is not.
 *
 * See docs/deploy/HARDENING.md, "PM2".
 */
module.exports = {
  apps: [
    {
      name: 'whatsapp-crm', // the name the code's comments use (`pm2 logs whatsapp-crm`)
      cwd: '/home/crm/Whatsapp-CRM',
      // `npm start` is `tsx server.ts`; calling tsx directly keeps PM2's
      // signals going to the app rather than to npm.
      script: 'server.ts',
      interpreter: './node_modules/.bin/tsx',

      // ONE process, fork mode. Rate limits (src/lib/rate-limit.ts), the
      // Socket.io rooms and the minute-by-minute sweeps in server.ts all live
      // in this process's memory. Cluster mode or instances > 1 would split
      // the limits (N x the allowed guesses), drop real-time events for users
      // on the other process, and run every background job N times.
      exec_mode: 'fork',
      instances: 1,

      // 2 GB VPS: restart before the kernel's OOM killer picks something
      // worse (like PostgreSQL). Keep node's heap below the restart line.
      node_args: '--max-old-space-size=1024',
      max_memory_restart: '1200M',

      autorestart: true,
      min_uptime: '30s',
      max_restarts: 10,
      exp_backoff_restart_delay: 200,
      kill_timeout: 10000, // let in-flight requests and sweeps finish

      time: true, // timestamp every log line
      merge_logs: true,
      out_file: '/home/crm/.pm2/logs/whatsapp-crm-out.log',
      error_file: '/home/crm/.pm2/logs/whatsapp-crm-error.log',

      env: {
        // Required. server.ts runs Next in DEV mode for any other value:
        // no Secure cookie flag, dev error pages, on-demand compiling.
        NODE_ENV: 'production',
        PORT: '3000',
        // Loopback only — nginx is the one way in (see server.ts BIND_HOST).
        BIND_HOST: '127.0.0.1',
        // Never set APP_ENV=development on a server (AGENTS.md "Data safety").
      },
    },
  ],
}

/*
 * Log rotation (pm2-logrotate), once per server, as the app user:
 *   pm2 set pm2-logrotate:max_size 50M
 *   pm2 set pm2-logrotate:retain 14          # ~2 weeks; logs hold phone numbers
 *   pm2 set pm2-logrotate:compress true
 *   pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
 */
