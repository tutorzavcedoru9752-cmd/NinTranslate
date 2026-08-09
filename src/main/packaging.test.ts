import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface BuildResource {
  to?: string;
  filter?: string[];
}

interface PackageManifest {
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

  it('verifies and packages every RapidOCR PP-OCRv5 model group', () => {
    const models = [
      'ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx',
      'ch_PP-OCRv5_det_mobile.onnx',
      'ch_PP-OCRv5_rec_mobile.onnx',
      'ch_PP-OCRv5_rec_server.onnx',
      'eslav_PP-OCRv5_rec_mobile.onnx',
      'korean_PP-OCRv5_rec_mobile.onnx',
      'latin_PP-OCRv5_rec_mobile.onnx',
      'layout_cdla.onnx',
      'layout_publaynet.onnx'
    ];
    const prepareScript = fs.readFileSync(path.join(projectRoot, 'scripts', 'prepare-ocr.mjs'), 'utf8');
    for (const model of models) {
      expect(prepareScript).toContain(`'${model}'`);
    }
    expect(manifest.build?.extraResources).toContainEqual(expect.objectContaining({ to: 'rapidocr' }));
    const buildScript = fs.readFileSync(path.join(projectRoot, 'scripts', 'build-rapidocr.mjs'), 'utf8');
    expect(buildScript).toContain("'--collect-data', 'rapid_layout'");
  });

  it('builds and verifies a native RapidOCR runtime for both Mac architectures', () => {
    const workflow = fs.readFileSync(
      path.join(projectRoot, '.github', 'workflows', 'build-macos.yml'),
      'utf8'
    );
    expect(workflow).toContain('runner: macos-15');
    expect(workflow).toContain('runner: macos-15-intel');
    expect(workflow).toContain('machine_arch: arm64');
    expect(workflow).toContain('machine_arch: x86_64');
    expect(workflow).toContain('python-version: "3.12"');
    expect(workflow).toContain('npm run build:rapidocr');
    expect(workflow).toContain('rapidocr/runtime/darwin-${{ matrix.arch }}/rapidocr-sidecar/rapidocr-sidecar');
    expect(workflow).toContain('test "$(uname -m)" = "${{ matrix.machine_arch }}"');
    expect(workflow).toContain('lipo -archs "$SIDECAR"');
    expect(workflow).toContain('lipo -archs "$APP_BINARY"');
  });
});
