const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const electronPath = path.resolve(__dirname, '../node_modules/.pnpm/electron@34.2.0/node_modules/electron/install.js');

if (!fs.existsSync(electronPath)) return;

exec(`node ${electronPath}`, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error executing script: ${error.message}`);
    return;
  }
  if (stderr) {
    console.error(`Error: ${stderr}`);
    return;
  }
  console.log(`Output: ${stdout}`);
});