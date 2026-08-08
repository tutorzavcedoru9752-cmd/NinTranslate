import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface BuildResource {
  to?: string;
  filter?: string[];
}

interface PackageManifest {
  dependencies?: Record<string, string>;
  build?: {
    files?: string[];
    extraResources?: BuildResource[];
  };
}

describe('macOS packaging safeguards', () => {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
  ) as PackageManifest;

  it('ships every brand asset used by the packaged main process', () => {
    const brandResource = manifest.build?.extraResources?.find((resource) => resource.to === 'brand');
    expect(brandResource?.filter).toEqual(expect.arrayContaining([
      'nintranslate-app-icon.png',
      'nintranslate-window.png',
      'nintranslate-tray.png'
    ]));
  });

  it('registers IPC before optional macOS UI initialization', () => {
    const source = fs.readFileSync(path.join(projectRoot, 'src', 'main', 'main.ts'), 'utf8');
    const singleInstanceBranch = source.indexOf('else {', source.indexOf('const hasLock'));
    const registerPosition = source.indexOf('registerIpc();', singleInstanceBranch);
    const readyPosition = source.indexOf('app.whenReady()', singleInstanceBranch);
    expect(registerPosition).toBeGreaterThan(singleInstanceBranch);
    expect(registerPosition).toBeLessThan(readyPosition);
  });

  it('declares and prepares every bundled OCR language model', () => {
    const languages = ['chi_sim', 'chi_tra', 'eng', 'jpn', 'kor', 'fra', 'deu', 'spa', 'por', 'rus'];
    const prepareScript = fs.readFileSync(path.join(projectRoot, 'scripts', 'prepare-ocr.mjs'), 'utf8');
    for (const language of languages) {
      expect(manifest.dependencies?.[`@tesseract.js-data/${language}`]).toBeTruthy();
      expect(prepareScript).toContain(`'${language}'`);
    }
    expect(manifest.build?.files).toContain('!node_modules/@tesseract.js-data/**/*');
  });
});
