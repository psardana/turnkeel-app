import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.js';

describe('parseArgs', () => {
  it('starts local mode, opening the browser, when it gets nothing', () => {
    // The first run starts empty, with no demo.
    expect(parseArgs([])).toEqual({ kind: 'start', port: undefined, open: true, demo: false });
  });

  it('takes --no-open', () => {
    expect(parseArgs(['--no-open'])).toEqual({
      kind: 'start',
      port: undefined,
      open: false,
      demo: false,
    });
  });

  it('--demo loads the demo on the first run, and --no-demo is still taken, as a no-op', () => {
    expect(parseArgs(['--demo'])).toEqual({
      kind: 'start',
      port: undefined,
      open: true,
      demo: true,
    });
    expect(parseArgs(['--no-demo'])).toEqual({
      kind: 'start',
      port: undefined,
      open: true,
      demo: false,
    });
    expect(parseArgs(['--no-open', '--demo', '--port', '4500'])).toEqual({
      kind: 'start',
      port: 4500,
      open: false,
      demo: true,
    });
    // The last of the two wins, as for --port.
    expect(parseArgs(['--demo', '--no-demo'])).toMatchObject({ demo: true });
  });

  it.each([
    [['--port', '4500'], 4500],
    [['--port=4500'], 4500],
    [['--port', '1'], 1],
    [['--port', '65535'], 65535],
    [['--port', '4500', '--port', '4600'], 4600],
  ])('takes the port from %j', (argv, port) => {
    expect(parseArgs(argv)).toEqual({ kind: 'start', port, open: true, demo: false });
  });

  it('takes both options in either order', () => {
    const expected = { kind: 'start', port: 4500, open: false, demo: false };
    expect(parseArgs(['--no-open', '--port', '4500'])).toEqual(expected);
    expect(parseArgs(['--port=4500', '--no-open'])).toEqual(expected);
  });

  it.each(['0', '65536', '-1', '4500.5', 'abc', '0x10', '1e3', ' 4500', '123456'])(
    'refuses the port "%s"',
    (value) => {
      expect(parseArgs(['--port', value])).toEqual({
        kind: 'error',
        message: `--port takes a number from 1 to 65535, not "${value}".`,
      });
    },
  );

  it.each([[['--port']], [['--port=']], [['--no-open', '--port']]])(
    'says that --port needs a number in %j',
    (argv) => {
      expect(parseArgs(argv)).toEqual({
        kind: 'error',
        message: '--port needs a number, as in "--port 4400".',
      });
    },
  );

  it.each([['--help'], ['-h']])('answers %s with the help', (flag) => {
    expect(parseArgs([flag])).toEqual({ kind: 'help' });
    // Also when the rest of the line is wrong.
    expect(parseArgs(['--port', 'abc', flag])).toEqual({ kind: 'help' });
    expect(parseArgs(['sync', flag])).toEqual({ kind: 'help' });
  });

  it.each([['--version'], ['-V']])('answers %s with the version', (flag) => {
    expect(parseArgs([flag])).toEqual({ kind: 'version' });
    expect(parseArgs(['--nonsense', flag])).toEqual({ kind: 'version' });
  });

  it.each([
    ['--demos', '--demos'],
    ['--open', '--open'],
    ['-p', '-p'],
    ['--host=0.0.0.0', '--host'],
  ])('names the option %s, which it does not have', (arg, named) => {
    expect(parseArgs([arg])).toEqual({
      kind: 'error',
      message: `turnkeel does not have the option "${named}".`,
    });
  });

  it.each(['sync', 'init', 'hooks', 'launch'])(
    'names the command %s, which it does not have yet',
    (command) => {
      expect(parseArgs([command])).toEqual({
        kind: 'error',
        message: `turnkeel does not have the command "${command}".`,
      });
    },
  );
});
