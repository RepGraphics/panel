import { spawn } from 'node:child_process';

const graceMs = Number.parseInt(process.env.BUILD_EXIT_GRACE_MS || '30000', 10);
const heartbeatMs = Number.parseInt(process.env.BUILD_HEARTBEAT_MS || '15000', 10);
const hardTimeoutMs = Number.parseInt(process.env.BUILD_HARD_TIMEOUT_MS || '1800000', 10);
const args = ['--no-deprecation', './node_modules/nuxt/bin/nuxt.mjs', 'build', ...process.argv.slice(2)];

let sawCompletion = false;
const start = Date.now();
let graceTimer = null;
let killTimer = null;
let hardTimeout = null;
let tailBuffer = '';
let lastOutputAt = Date.now();
let stage = 'initializing';

const child = spawn(process.execPath, args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['inherit', 'pipe', 'pipe'],
});

function streamWrite(isErr, chunk) {
  if (isErr) {
    process.stderr.write(chunk);
    return;
  }

  process.stdout.write(chunk);
}

function scheduleGracefulExit() {
  if (graceTimer) {
    return;
  }

  process.stdout.write(
    `\n[build] Completion marker detected; allowing ${Math.round(graceMs / 1000)}s for clean shutdown.\n`,
  );

  graceTimer = setTimeout(() => {
    if (child.exitCode !== null) {
      return;
    }

    process.stderr.write(
      `[build] Build completed but process is still alive. Sending SIGTERM to PID ${child.pid}.\n`,
    );
    child.kill('SIGTERM');

    killTimer = setTimeout(() => {
      if (child.exitCode === null) {
        process.stderr.write(`[build] Process did not stop; sending SIGKILL to PID ${child.pid}.\n`);
        child.kill('SIGKILL');
      }
    }, 5000);

    killTimer.unref();
  }, graceMs);

  graceTimer.unref();
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function handleChunk(isErr, chunk) {
  streamWrite(isErr, chunk);

  lastOutputAt = Date.now();
  const text = stripAnsi(String(chunk));
  tailBuffer = (tailBuffer + text).slice(-2048);

  if (/building client/i.test(tailBuffer)) {
    stage = 'client';
  } else if (/building server/i.test(tailBuffer)) {
    stage = 'server';
  } else if (/building nuxt nitro server/i.test(tailBuffer)) {
    stage = 'nitro';
  } else if (/pwa v/i.test(tailBuffer)) {
    stage = 'pwa';
  }

  if (!sawCompletion && /build\s+complete!?/i.test(tailBuffer)) {
    sawCompletion = true;
    scheduleGracefulExit();
  }
}

child.stdout?.on('data', (chunk) => handleChunk(false, chunk));
child.stderr?.on('data', (chunk) => handleChunk(true, chunk));

const heartbeat = setInterval(() => {
  const elapsedSeconds = Math.floor((Date.now() - start) / 1000);
  const idleSeconds = Math.floor((Date.now() - lastOutputAt) / 1000);
  process.stdout.write(
    `[build] Running... ${elapsedSeconds}s elapsed | stage=${stage} | ${idleSeconds}s since last output.\n`,
  );
}, heartbeatMs);
heartbeat.unref();

hardTimeout = setTimeout(() => {
  if (child.exitCode !== null) {
    return;
  }

  process.stderr.write(
    `[build] Hard timeout reached (${Math.round(hardTimeoutMs / 1000)}s). Stopping PID ${child.pid}.\n`,
  );
  child.kill('SIGTERM');

  setTimeout(() => {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }, 5000).unref();
}, hardTimeoutMs);
hardTimeout.unref();

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (child.exitCode === null) {
      child.kill(signal);
    }
  });
}

child.on('exit', (code, signal) => {
  clearInterval(heartbeat);

  if (graceTimer) {
    clearTimeout(graceTimer);
  }

  if (killTimer) {
    clearTimeout(killTimer);
  }

  if (hardTimeout) {
    clearTimeout(hardTimeout);
  }

  if (signal) {
    if (sawCompletion) {
      process.exit(0);
    }

    process.exit(1);
  }

  process.exit(code ?? (sawCompletion ? 0 : 1));
});
