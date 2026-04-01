// Launcher: removes ELECTRON_RUN_AS_NODE before starting Electron.
// This is needed when running from VS Code terminal, which sets this variable
// causing Electron to behave as plain Node.js instead of a desktop app.
const { spawn } = require('child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });
child.on('close', (code) => process.exit(code || 0));
