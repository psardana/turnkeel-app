#!/usr/bin/env node
// The one sentence outside the message catalogue: it has to be said before anything
// of the package is loaded, by a Node that may be too old to load it.
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);

const { main } = await import('../dist/index.js');
process.exitCode = await main(process.argv.slice(2));
