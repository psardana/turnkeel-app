// @ts-check
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { AGPL, MIT, packageRules } from '../tooling/boundaries.js';

/**
 * Proves that the published packages install and work outside this repository.
 *
 * 1. `pnpm pack` on each published package, into a folder outside the repository.
 * 2. Checks what each tarball holds: the licence, the entry files, no sources,
 *    no workspace versions.
 * 3. Installs the five tarballs with npm into an empty folder, also outside.
 * 4. Runs `npx turnkeel --no-open --demo` there on a free port with a new data folder,
 *    reads `/healthz`, opens the one-time URL, reads `/api/v1/me` as the local
 *    owner, creates a project, loads the web app, and stops it as Ctrl-C would.
 *
 * Nothing is published to any registry. The packages must be built first
 * (`pnpm build`); `pnpm test:pack` does both.
 *
 * `PACK_SMOKE_KEEP=1` keeps the temporary folder, to look at what was installed.
 */

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));

/** What a published package's tarball must hold when nothing else is said. */
const library = ['dist/index.js', 'dist/index.d.ts'];

/**
 * What two of the packages hold besides, or instead.
 * @type {Record<string, { bin?: string, holds: string[] }>}
 */
const particular = {
  turnkeel: {
    bin: 'bin/turnkeel.js',
    holds: [
      'bin/turnkeel.js',
      ...library,
      // The three templates, as plain files.
      'templates/README.md',
      'templates/app-launch/gates/app-store.md',
      'templates/saas-launch/docs.yml',
      'templates/browser-extension/steps/install-and-first-use.md',
    ],
  },
  // No type declarations: nothing imports the server (apps/server/tsdown.config.ts).
  '@turnkeel/server': {
    holds: [
      'dist/index.js',
      'dist/doc-scan-worker.js',
      'dist/migrations/meta/_journal.json',
      'dist/web/index.html',
      'dist/web/sw.js',
      // The demo's own .turnkeel folder and pictures.
      'dist/demo/.turnkeel/docs.yml',
    ],
  },
};

/**
 * The published packages, the ones tooling/boundaries.js marks `published`.
 * @type {{ name: string, dir: string, license: string, bin?: string, holds: string[] }[]}
 */
const packages = packageRules
  .filter((rule) => rule.published)
  .map((rule) => ({
    name: rule.name,
    dir: rule.dir,
    license: rule.license,
    holds: library,
    ...particular[rule.name],
  }));

/**
 * The first words of each licence text.
 * @type {Record<string, string>}
 */
const licenceStart = {
  [MIT]: 'MIT License',
  [AGPL]: 'GNU AFFERO GENERAL PUBLIC LICENSE',
};

/** How long the slow steps get: the install from the registry, and the first start. */
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const START_TIMEOUT_MS = 3 * 60_000;
const STOP_TIMEOUT_MS = 60_000;

/** @param {string} line */
const say = (line) => console.log(line);

/**
 * @param {unknown} condition
 * @param {string} message
 * @returns {asserts condition}
 */
function check(condition, message) {
  if (!condition) throw new Error(message);
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @returns {Promise<number>} */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/**
 * The environment for what runs outside the repository: this one, without anything
 * that configures a Turnkeel server, so that a variable a developer has set cannot
 * change what is tested. Update checks of npm are off.
 *
 * @param {Record<string, string>} extra
 * @returns {NodeJS.ProcessEnv}
 */
function cleanEnv(extra = {}) {
  const configures =
    /^(TURNKEEL_|DATABASE_URL|TEST_DATABASE_URL|SMTP_URL|MAIL_FROM|S3_|GITHUB_CLIENT_|GOOGLE_CLIENT_|E2E_)/;
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    // npm_* and PNPM_* are what `pnpm run` adds; npm must not read them as its own settings.
    if (configures.test(key) || /^(npm_|pnpm_)/i.test(key)) continue;
    env[key] = value;
  }
  return {
    ...env,
    NO_UPDATE_NOTIFIER: '1',
    npm_config_update_notifier: 'false',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    ...extra,
  };
}

/** `npx` and `npm` are scripts on Windows, and need a shell there. */
const viaShell = process.platform === 'win32';

/**
 * Packs one package and checks what the tarball holds.
 *
 * @param {(typeof packages)[number]} pkg
 * @param {string} destination
 * @returns {Promise<string>} The tarball's path.
 */
async function pack(pkg, destination) {
  const dir = path.join(root, pkg.dir);
  for (const file of pkg.holds) {
    check(
      existsSync(path.join(dir, file)),
      `${pkg.dir}/${file} is not there. Build the packages first: pnpm build`,
    );
  }
  const { stdout } = await run('pnpm', ['pack', '--json', '--pack-destination', destination], {
    cwd: dir,
    shell: viaShell,
    maxBuffer: 32 * 1024 * 1024,
  });
  /** @type {{ name: string, version: string, filename: string, files: { path: string }[] }} */
  const packed = JSON.parse(stdout.slice(stdout.indexOf('{')));
  const files = packed.files.map((file) => file.path);

  check(packed.name === pkg.name, `${pkg.dir} packed as ${packed.name}, not as ${pkg.name}.`);
  for (const file of [...pkg.holds, 'package.json', 'LICENSE']) {
    check(files.includes(file), `The tarball of ${pkg.name} has no ${file}.`);
  }
  const strays = files.filter(
    (file) =>
      !(
        file === 'package.json' ||
        file === 'LICENSE' ||
        file === 'README.md' ||
        file.startsWith('dist/') ||
        file.startsWith('bin/') ||
        (pkg.name === 'turnkeel' && file.startsWith('templates/'))
      ),
  );
  check(strays.length === 0, `The tarball of ${pkg.name} holds ${strays.join(', ')}.`);
  const tests = files.filter((file) => /\.test\.|\/testing\//.test(file));
  check(tests.length === 0, `The tarball of ${pkg.name} holds tests: ${tests.join(', ')}.`);

  say(`  ${pkg.name} ${packed.version}: ${files.length} files`);
  return packed.filename;
}

/**
 * Checks an installed package against what a published one has to be.
 *
 * @param {(typeof packages)[number]} pkg
 * @param {string} installDir
 */
function checkInstalled(pkg, installDir) {
  const dir = path.join(installDir, 'node_modules', ...pkg.name.split('/'));
  /** @type {Record<string, any>} */
  const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));

  check(manifest.license === pkg.license, `${pkg.name} says its licence is ${manifest.license}.`);
  const licence = readFileSync(path.join(dir, 'LICENSE'), 'utf8').trimStart();
  check(
    licence.startsWith(licenceStart[pkg.license] ?? 'no such licence'),
    `The LICENSE file of ${pkg.name} is not the text of ${pkg.license}.`,
  );
  check(manifest.private !== true, `${pkg.name} is marked private.`);
  check(manifest.type === 'module', `${pkg.name} is not an ES module package.`);
  check(
    typeof manifest.engines?.node === 'string',
    `${pkg.name} does not say which Node it needs.`,
  );

  // The entry points name files that are there.
  const entry = manifest.exports?.['.'];
  const targets = typeof entry === 'string' ? [entry] : Object.values(entry ?? {});
  check(targets.length > 0, `${pkg.name} has no "exports".`);
  for (const target of targets) {
    check(
      typeof target === 'string' && target.startsWith('./dist/'),
      `${pkg.name} exports ${String(target)}, which is not in dist/.`,
    );
    check(existsSync(path.join(dir, target)), `${pkg.name} exports ${target}, which is missing.`);
  }
  if (pkg.bin !== undefined) {
    const bin = manifest.bin?.turnkeel;
    check(typeof bin === 'string', `${pkg.name} has no bin named turnkeel.`);
    check(path.normalize(bin) === path.normalize(pkg.bin), `${pkg.name} has the bin ${bin}.`);
    check(existsSync(path.join(dir, bin)), `${pkg.name} names the bin ${bin}, which is missing.`);
  } else {
    check(manifest.bin === undefined, `${pkg.name} has a bin, and should have none.`);
  }

  // A workspace or catalogue version means nothing outside this repository.
  const dependencies = { ...manifest.dependencies, ...manifest.peerDependencies };
  for (const [name, version] of Object.entries(dependencies)) {
    check(
      /^\d+\.\d+\.\d+/.test(String(version)),
      `${pkg.name} depends on ${name}@${String(version)}, which is not an exact version.`,
    );
  }
  // What is not published is bundled, never named.
  for (const name of Object.keys(dependencies)) {
    if (!name.startsWith('@turnkeel/')) continue;
    check(
      packages.some((other) => other.name === name),
      `${pkg.name} depends on ${name}, which is not published.`,
    );
  }
  return manifest;
}

/**
 * Starts `npx turnkeel --no-open --demo` in the install folder and returns what it prints.
 *
 * @param {string} installDir
 * @param {number} port
 * @param {string} dataDir
 */
function startTurnkeel(installDir, port, dataDir) {
  // A process group of its own, so that it can be stopped the way Ctrl-C in a
  // terminal stops it: with SIGINT to the whole group.
  const child = spawn(
    'npx',
    ['--no-install', 'turnkeel', '--no-open', '--demo', '--port', String(port)],
    {
      cwd: installDir,
      env: cleanEnv({ TURNKEEL_DATA_DIR: dataDir }),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: !viaShell,
      shell: viaShell,
    },
  );
  let output = '';
  /** @type {number | null | undefined} */
  let exitCode;
  child.stdout.on('data', (chunk) => (output += String(chunk)));
  child.stderr.on('data', (chunk) => (output += String(chunk)));
  child.once('exit', (code) => (exitCode = code));

  return {
    output: () => output,
    exited: () => exitCode !== undefined,
    exitCode: () => exitCode,
    /** @param {NodeJS.Signals} signal */
    signal(signal) {
      if (child.pid === undefined) return;
      try {
        if (viaShell) child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {
        // Gone already.
      }
    },
    /**
     * Waits until the output matches.
     * @param {RegExp} pattern
     * @param {number} timeoutMs
     * @param {string} what
     */
    async said(pattern, timeoutMs, what) {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const found = pattern.exec(output);
        if (found) return found;
        check(exitCode === undefined, `turnkeel exited with ${String(exitCode)} before ${what}.`);
        check(Date.now() < until, `turnkeel did not get to ${what} in ${timeoutMs / 1000} s.`);
        await sleep(100);
      }
    },
  };
}

/**
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function answers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // Outside the repository, so that nothing is found by walking up from it.
  const work = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'turnkeel-pack-'));
  check(
    path.relative(root, work).startsWith('..'),
    `The temporary folder ${work} is inside the repository.`,
  );
  const tarballDir = path.join(work, 'tarballs');
  const installDir = path.join(work, 'install');
  const dataDir = path.join(work, 'data');
  mkdirSync(tarballDir);
  mkdirSync(installDir);

  /** @type {ReturnType<typeof startTurnkeel> | undefined} */
  let turnkeel;
  let passed = false;
  try {
    say('Packing the published packages:');
    /** @type {Record<string, string>} */
    const tarballs = {};
    for (const pkg of packages) tarballs[pkg.name] = await pack(pkg, tarballDir);

    say(`Installing the tarballs with npm into ${installDir}`);
    // Every package is named, so that npm takes each from its tarball. The overrides
    // say the same for where one of them depends on another.
    await writeFile(
      path.join(installDir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'turnkeel-pack-smoke',
          version: '0.0.0',
          private: true,
          dependencies: Object.fromEntries(
            packages.map((pkg) => [pkg.name, `file:${tarballs[pkg.name]}`]),
          ),
          overrides: Object.fromEntries(packages.map((pkg) => [pkg.name, `$${pkg.name}`])),
        },
        null,
        2,
      )}\n`,
    );
    await run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
      cwd: installDir,
      env: cleanEnv(),
      shell: viaShell,
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
    });

    say('Checking the installed packages:');
    for (const pkg of packages) {
      const manifest = checkInstalled(pkg, installDir);
      say(`  ${pkg.name}: ${manifest.license}, entry points and licence text in place`);
    }
    // The launcher is MIT and holds no server code: it names the server only to find it.
    const launcher = readFileSync(
      path.join(installDir, 'node_modules', 'turnkeel', 'dist', 'index.js'),
      'utf8',
    );
    check(
      !/from\s*["']@turnkeel\/(server|core|db)|import\(\s*["']@turnkeel\/(core|db)/.test(launcher),
      'The turnkeel package imports server code.',
    );
    check(
      launcher.includes('import.meta.resolve("@turnkeel/server")'),
      'The turnkeel package does not look up @turnkeel/server.',
    );
    check(
      !existsSync(path.join(installDir, 'node_modules', '@turnkeel', 'core')) &&
        !existsSync(path.join(installDir, 'node_modules', '@turnkeel', 'db')) &&
        !existsSync(path.join(installDir, 'node_modules', '@turnkeel', 'web')),
      'A package that is not published was installed.',
    );

    // The three libraries can be imported, and the server resolves to the installed copy.
    const { stdout: imported } = await run(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `const names = ['@turnkeel/protocol', '@turnkeel/mcp', '@turnkeel/connector-sdk'];
         for (const name of names) {
           const exports = Object.keys(await import(name));
           if (exports.length === 0) throw new Error(name + ' exports nothing.');
         }
         console.log(import.meta.resolve('@turnkeel/server'));`,
      ],
      { cwd: installDir, env: cleanEnv() },
    );
    const serverEntry = realpathSync(fileURLToPath(imported.trim()));
    check(
      serverEntry ===
        path.join(installDir, 'node_modules', '@turnkeel', 'server', 'dist', 'index.js'),
      `@turnkeel/server resolves to ${serverEntry}.`,
    );

    const { stdout: version } = await run('npx', ['--no-install', 'turnkeel', '--version'], {
      cwd: installDir,
      env: cleanEnv(),
      shell: viaShell,
    });
    check(/^turnkeel \d+\.\d+\.\d+/.test(version.trim()), `turnkeel --version said: ${version}`);
    const { stdout: help } = await run('npx', ['--no-install', 'turnkeel', '--help'], {
      cwd: installDir,
      env: cleanEnv(),
      shell: viaShell,
    });
    check(
      help.includes('--no-open') && help.includes('--port'),
      'turnkeel --help is not the help.',
    );
    say(`  npx turnkeel --version: ${version.trim()}`);

    // The templates come out of the installed package, and only out of it: a
    // package named `templates` beside it in node_modules is never read.
    const decoy = path.join(installDir, 'node_modules', 'templates', 'app-launch', 'gates');
    mkdirSync(decoy, { recursive: true });
    await writeFile(path.join(decoy, 'planted.md'), '## Planted\n\n- id: planted\n');
    const repo = path.join(work, 'repo');
    mkdirSync(repo);
    const { stdout: init } = await run(
      process.execPath,
      [
        path.join(installDir, 'node_modules', 'turnkeel', 'bin', 'turnkeel.js'),
        'init',
        '--template',
        'app-launch',
      ],
      { cwd: repo, env: cleanEnv() },
    );
    check(
      existsSync(path.join(repo, '.turnkeel', 'gates', 'app-store.md')) &&
        existsSync(path.join(repo, '.turnkeel', 'turnkeel.yml')),
      `turnkeel init --template app-launch wrote no gate files: ${init}`,
    );
    check(
      !existsSync(path.join(repo, '.turnkeel', 'gates', 'planted.md')) && !init.includes('planted'),
      `turnkeel init read the templates of another package: ${init}`,
    );
    rmSync(path.join(installDir, 'node_modules', 'templates'), { recursive: true, force: true });
    say('  npx turnkeel init --template app-launch: the template is written');

    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    say(`Starting local mode: npx turnkeel --no-open --demo --port ${port}`);
    turnkeel = startTurnkeel(installDir, port, dataDir);
    const found = await turnkeel.said(
      /Open this address once to use Turnkeel in your browser: (\S+)/,
      START_TIMEOUT_MS,
      'the one-time URL',
    );
    const oneTimeUrl = found[1] ?? '';
    check(
      oneTimeUrl.startsWith(`${base}/api/v1/local/session?code=`),
      `The one-time URL is ${oneTimeUrl}.`,
    );
    check(
      turnkeel.output().includes(`Turnkeel is listening at ${base}`),
      'turnkeel did not print its address.',
    );
    check(existsSync(path.join(dataDir, 'db')), `The data folder ${dataDir} has no database.`);

    const health = await fetch(`${base}/healthz`);
    check(health.status === 200, `/healthz answered ${health.status}.`);
    check(
      /** @type {{ status?: unknown }} */ (await health.json()).status === 'ok',
      '/healthz did not say ok.',
    );
    say('  /healthz: 200');

    const before = await fetch(`${base}/api/v1/me`);
    check(before.status === 401, `/api/v1/me without the local session answered ${before.status}.`);

    const session = await fetch(oneTimeUrl, { redirect: 'manual' });
    check(session.status === 302, `The one-time URL answered ${session.status}.`);
    const cookie = session.headers
      .getSetCookie()
      .map((line) => line.split(';')[0])
      .join('; ');
    check(cookie.startsWith('turnkeel_local='), 'The one-time URL set no local session cookie.');
    const again = await fetch(oneTimeUrl, { redirect: 'manual' });
    check(again.status === 401, `The one-time URL worked a second time (${again.status}).`);
    say('  one-time URL: 302 with the local session cookie, then 401');

    const meResponse = await fetch(`${base}/api/v1/me`, { headers: { cookie } });
    check(meResponse.status === 200, `/api/v1/me answered ${meResponse.status}.`);
    /** @typedef {{ local?: boolean, workspaces?: { workspace: { slug: string }, role: string }[] }} Me */
    const me = /** @type {Me} */ (await meResponse.json());
    check(me.local === true, '/api/v1/me does not say this is the local owner.');
    const workspace = me.workspaces?.[0];
    check(
      workspace?.workspace.slug === 'demo' && workspace.role === 'owner',
      `/api/v1/me lists ${JSON.stringify(me.workspaces)}.`,
    );
    say('  /api/v1/me: the local owner, Owner of the demo workspace');
    check(
      turnkeel.output().includes('the demo workspace "Demo" is loaded'),
      'turnkeel did not say that the demo was loaded.',
    );
    check(!/tk_[A-Za-z0-9_-]{8,}/.test(turnkeel.output()), 'turnkeel printed a token.');
    const taken = await fetch(`${base}/api/v1/local/demo-token`, {
      method: 'POST',
      headers: { cookie, origin: base },
    });
    const demo = /** @type {{ demo: { token?: string } | null }} */ (await taken.json()).demo;
    check(
      taken.status === 200 && typeof demo?.token === 'string',
      'The first run did not hand over the demo token.',
    );
    say('  the demo is loaded, and its token is handed to the first page');

    // One write, which needs the migrations and the event log.
    const created = await fetch(`${base}/api/v1/workspaces/demo/projects`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Packed', key: 'PACK', slug: 'packed' }),
    });
    check(created.status === 201, `Creating a project answered ${created.status}.`);
    const events = await fetch(`${base}/api/v1/workspaces/demo/events`, {
      headers: { cookie },
    });
    check(events.status === 200, `The event list answered ${events.status}.`);
    check(
      (await events.text()).includes('project.created'),
      'The event log has no project.created.',
    );
    say('  a project was created, and the event log has it');

    // A docs sync, whose docs the server reads in a worker thread of its own file
    // (dist/doc-scan-worker.js).
    const docs = await fetch(`${base}/api/v1/workspaces/demo/projects/PACK/docs/sync`, {
      method: 'POST',
      headers: { cookie, origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({
        docs: [{ path: 'docs/a.md', group: 'Docs', text: '# A\n\n![x](img/x.png)' }],
        dryRun: true,
      }),
    });
    const docsText = await docs.text();
    check(
      docs.status === 200 && docsText.includes('docs/img/x.png'),
      `A dry run of a docs sync answered ${docs.status}: ${docsText.slice(0, 300)}`,
    );
    say('  a doc was read for its images in the worker of the bundle');

    // The web app comes out of the server package.
    const shell = await fetch(`${base}/w/demo/activity`);
    const html = await shell.text();
    check(
      shell.status === 200 && (shell.headers.get('content-type') ?? '').includes('text/html'),
      `The app shell answered ${shell.status}.`,
    );
    const script = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    check(script !== undefined, 'The app shell names no script.');
    const asset = await fetch(`${base}${script}`);
    check(asset.status === 200, `${script} answered ${asset.status}.`);
    await asset.arrayBuffer();
    say('  the web app: the shell and its script are served');

    say('Stopping it as Ctrl-C does');
    turnkeel.signal('SIGINT');
    const until = Date.now() + STOP_TIMEOUT_MS;
    while (
      !turnkeel.exited() ||
      !turnkeel.output().includes('Turnkeel has stopped.') ||
      existsSync(path.join(dataDir, 'server.lock')) ||
      (await answers(`${base}/healthz`))
    ) {
      check(Date.now() < until, 'turnkeel did not stop cleanly.');
      await sleep(200);
    }
    say('  stopped: nothing listens, and the data folder is free');

    passed = true;
    say('The pack smoke test passed.');
  } catch (error) {
    if (turnkeel) {
      console.error('--- what turnkeel printed ---');
      console.error(turnkeel.output());
      console.error('-----------------------------');
    }
    throw error;
  } finally {
    if (turnkeel && !turnkeel.exited()) {
      turnkeel.signal('SIGKILL');
      await sleep(500);
    }
    if (process.env.PACK_SMOKE_KEEP === '1' || !passed) {
      say(`Kept ${work}`);
    } else {
      rmSync(work, { recursive: true, force: true, maxRetries: 5 });
    }
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
