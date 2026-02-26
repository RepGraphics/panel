import { spawn } from 'node:child_process';

const graceMs = Number.parseInt(process.env.BUILD_EXIT_GRACE_MS || '30000', 10);
const heartbeatMs = Number.parseInt(process.env.BUILD_HEARTBEAT_MS || '15000', 10);
const hardTimeoutMs = Number.parseInt(process.env.BUILD_HARD_TIMEOUT_MS || '1800000', 10);
const retryCount = Math.max(0, Number.parseInt(process.env.BUILD_RETRY_COUNT || '1', 10));
const buildArgs = ['--no-deprecation', './node_modules/nuxt/bin/nuxt.mjs', 'build', ...process.argv.slice(2)];
const cleanArgs = ['./scripts/clean-build.mjs'];

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function streamWrite(isErr, chunk) {
  if (isErr) {
    process.stderr.write(chunk);
    return;
  }

  process.stdout.write(chunk);
}

function isRetryableWindowsCleanupFailure(tailOutput) {
  const normalized = stripAnsi(tailOutput).toLowerCase();
  return (
    /(enotempty|eperm|ebusy)/i.test(normalized) &&
    /(rmdir|\.output|\.nuxt|node_modules[\\/]\.cache)/i.test(normalized)
  );
}

function runNodeCommand(args, label) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let sawCompletion = false;
    let stage = 'initializing';
    let tailBuffer = '';
    const startedAt = Date.now();
    let lastOutputAt = Date.now();
    let graceTimer = null;
    let killTimer = null;
    let hardTimeout = null;

    const signalHandlers = new Map();
    const clearSignalHandlers = () => {
      for (const [signal, handler] of signalHandlers) {
        process.off(signal, handler);
      }
      signalHandlers.clear();
    };

    const cleanup = () => {
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
      clearSignalHandlers();
    };

    const scheduleGracefulExit = () => {
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
    };

    const handleChunk = (isErr, chunk) => {
      streamWrite(isErr, chunk);

      lastOutputAt = Date.now();
      const text = stripAnsi(String(chunk));
      tailBuffer = (tailBuffer + text).slice(-4096);

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
    };

    child.stdout?.on('data', (chunk) => handleChunk(false, chunk));
    child.stderr?.on('data', (chunk) => handleChunk(true, chunk));

    const heartbeat = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      const idleSeconds = Math.floor((Date.now() - lastOutputAt) / 1000);
      process.stdout.write(
        `[build:${label}] Running... ${elapsedSeconds}s elapsed | stage=${stage} | ${idleSeconds}s since last output.\n`,
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
      const handler = () => {
        if (child.exitCode === null) {
          child.kill(signal);
        }
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }

    child.on('exit', (code, signal) => {
      cleanup();
      resolve({
        code: code ?? (sawCompletion ? 0 : 1),
        signal,
        sawCompletion,
        stage,
        tailBuffer,
      });
    });
  });
}

async function runBuildWithRecovery() {
  const maxAttempts = retryCount + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      process.stdout.write(`[build] Starting retry attempt ${attempt}/${maxAttempts}.\n`);
    }

    const result = await runNodeCommand(buildArgs, `attempt-${attempt}`);
    const succeeded = !result.signal && result.code === 0;

    if (succeeded) {
      return 0;
    }

    const canRetry =
      attempt < maxAttempts && isRetryableWindowsCleanupFailure(result.tailBuffer);

    if (!canRetry) {
      if (result.signal) {
        process.stderr.write(`[build] Build stopped by signal ${result.signal}.\n`);
      }
      return result.code || 1;
    }

    process.stderr.write(
      '[build] Detected Windows file-lock cleanup failure (ENOTEMPTY/EPERM/EBUSY). Running clean-build before retry.\n',
    );
    const cleanResult = await runNodeCommand(cleanArgs, `clean-${attempt}`);
    if (cleanResult.code !== 0 || cleanResult.signal) {
      process.stderr.write('[build] clean-build failed; aborting retry.\n');
      return cleanResult.code || 1;
    }
  }

  return 1;
}

const exitCode = await runBuildWithRecovery();
process.exit(exitCode);
