import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--watch', '--mode', 'development', '--emptyOutDir', 'false'], { stdio: 'inherit' }),
  spawn(process.execPath, ['scripts/build-content.mjs', '--watch'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
for (const child of children) child.on('exit', (code) => stop(code ?? 1));
