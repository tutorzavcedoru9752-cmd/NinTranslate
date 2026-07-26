import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildOutput = path.resolve(projectRoot, 'dist-electron');
if (!buildOutput.startsWith(`${projectRoot}${path.sep}`)) throw new Error('Refusing to clean outside the project directory.');
fs.rmSync(buildOutput, { recursive: true, force: true });
