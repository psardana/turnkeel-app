#!/usr/bin/env node
// The one sentence outside the message catalogue: it has to be said before anything
// of the package is loaded, by a Node that may be too old to load it.
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(`Turnkeel needs Node 22.12 or later. This is Node ${process.versions.node}.`);
  process.exit(1);
}

const { main } = await import('../dist/index.js');
process.exitCode = await main(process.argv.slice(2));
