/* eslint-disable no-console */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { pathToFileURL } = require('node:url');

const projectRoot = path.resolve(__dirname, '..');
const artifactRoot = path.join(projectRoot, 'output', 'playwright', 'ocr-random');
fs.mkdirSync(artifactRoot, { recursive: true });
const requestedSeed = Number(process.env.NINTRANSLATE_OCR_RANDOM_SEED);
const seed = Number.isFinite(requestedSeed) ? requestedSeed : Date.now();

function randomGenerator(initialSeed) {
  let value = initialSeed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

const random = randomGenerator(seed);
const pick = (values) => values[Math.floor(random() * values.length)];
const between = (minimum, maximum) => Math.round(minimum + random() * (maximum - minimum));
const escapeHtml = (value) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]));

const corpus = {
  latin: [
    'Clear tools should preserve meaning when a sentence wraps across several visual lines.',
    'A reliable screenshot translator keeps reading order stable across narrow cards and dialog boxes.',
    'Design decisions become easier to review when the original text remains editable.'
  ],
  cjk: [
    '真正可靠的截图翻译，不仅要识别单个文字，还要保留正确的阅读顺序和段落关系。',
    '画面中的视觉换行不一定代表新段落，用户手动输入的换行则应当始终保留。',
    '本地识别可以保护截图隐私，只有整理后的文字才会发送给翻译服务。'
  ],
  japanese: [
    '画面の改行と文章の段落は同じではないため、読み順を正しく判断する必要があります。',
    '認識した文章を編集できれば、小さな誤りを直してからもう一度翻訳できます。'
  ],
  cyrillic: [
    'Точный порядок чтения помогает правильно переводить текст из нескольких визуальных строк.',
    'Локальное распознавание сохраняет изображение на компьютере пользователя.'
  ]
};

function baseStyle(width, height) {
  const dark = random() > 0.5;
  const background = dark ? pick(['#17191d', '#20242d', '#27251f']) : pick(['#ffffff', '#f4f7fb', '#fffdf7']);
  const foreground = dark ? '#f3f5f7' : '#20242a';
  return { width, height, dark, background, foreground, fontSize: between(18, 25), lineHeight: between(135, 158) / 100 };
}

function singleParagraphCase(script, text) {
  const style = baseStyle(between(360, 560), between(190, 270));
  return {
    name: `single-${script}`,
    expected: text,
    html: `<p>${escapeHtml(text)}</p>`,
    style
  };
}

function makeCases() {
  const listItems = [
    '明确项目目标、系统服务对象和主要使用场景',
    '梳理VR/AR共性需求与初步验收指标',
    '完成低保真原型和核心页面高保真设计'
  ];
  const headline = 'US Navy launches billion-dollar drone from aircraft carrier in the ocean';
  const left = ['Left column starts here.', 'Its second line stays in the same column.'];
  const right = ['Right column starts here.', 'Reading continues downward before switching columns.'];
  const listStyle = baseStyle(680, 210);
  const columnStyle = baseStyle(760, 250);
  const eastAsian = random() > 0.5
    ? { script: 'cjk', text: pick(corpus.cjk) }
    : { script: 'japanese', text: pick(corpus.japanese) };
  return [
    singleParagraphCase('latin', pick(corpus.latin)),
    singleParagraphCase(eastAsian.script, eastAsian.text),
    singleParagraphCase('cyrillic', pick(corpus.cyrillic)),
    {
      name: 'ruled-list',
      expected: listItems.map((item, index) => `${index + 1}. ${item}`).join('\n\n'),
      html: `<div class="ruled">${listItems.map((item, index) => `<div>${index + 1}. ${escapeHtml(item)}</div>`).join('')}</div>`,
      style: listStyle
    },
    {
      name: 'headline-hyphen',
      expected: headline,
      html: `<h1>${escapeHtml(headline)}</h1>`,
      style: { ...baseStyle(410, 240), fontSize: between(25, 31) }
    },
    {
      name: 'two-columns',
      expected: `${left.join(' ')}\n\n${right.join(' ')}`,
      html: `<div class="columns"><section>${left.map((item) => `<p>${escapeHtml(item)}</p>`).join('')}</section><section>${right.map((item) => `<p>${escapeHtml(item)}</p>`).join('')}</section></div>`,
      style: columnStyle
    }
  ];
}

function pageHtml(testCase) {
  const { width, height, background, foreground, fontSize, lineHeight } = testCase.style;
  const font = pick(['Segoe UI', 'Arial', 'Microsoft YaHei UI', 'Noto Sans']);
  return `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}
    body{padding:${between(20, 34)}px;background:${background};color:${foreground};font:${fontSize}px/${lineHeight} "${font}",sans-serif}
    p{margin:0 0 ${between(10, 18)}px}.ruled{border-top:1px solid #76a8ed}.ruled>div{padding:7px 8px;border-bottom:1px solid #76a8ed}
    h1{width:${between(310, 355)}px;margin:0;font:700 ${fontSize}px/1.26 "${font}",sans-serif}
    .columns{display:grid;grid-template-columns:1fr 1fr;gap:${between(70, 105)}px}.columns section{min-width:0}.columns p{margin:0}
  </style>${testCase.html}`;
}

function normalize(value) {
  return value.normalize('NFKC').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + Number(left[leftIndex - 1] !== right[rightIndex - 1])
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function startSidecar() {
  const python = process.platform === 'win32'
    ? path.join(projectRoot, '.rapidocr-venv', 'Scripts', 'python.exe')
    : path.join(projectRoot, '.rapidocr-venv', 'bin', 'python');
  const child = spawn(python, [path.join(projectRoot, 'scripts', 'rapidocr_sidecar.py')], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NINTRANSLATE_OCR_MODEL_DIR: path.join(projectRoot, 'resources', 'rapidocr', 'models'),
      PYTHONIOENCODING: 'utf-8'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  const lines = readline.createInterface({ input: child.stdout });
  const waiting = new Map();
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  lines.on('line', (line) => {
    const response = JSON.parse(line);
    if (response.type === 'ready') return readyResolve();
    const request = waiting.get(response.id);
    if (!request) return;
    waiting.delete(response.id);
    if (response.ok) request.resolve(response.result);
    else request.reject(new Error(response.error));
  });
  let nextId = 0;
  return {
    child,
    ready,
    recognize(imageData) {
      const id = `browser-${nextId += 1}`;
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ id, action: 'recognize', imageData })}\n`);
      });
    }
  };
}

function findBrowser() {
  if (process.env.NINTRANSLATE_TEST_BROWSER && fs.existsSync(process.env.NINTRANSLATE_TEST_BROWSER)) {
    return process.env.NINTRANSLATE_TEST_BROWSER;
  }
  const candidates = process.platform === 'win32' ? [
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ] : [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ];
  const browser = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!browser) throw new Error('未找到可用于真实截图测试的 Chrome 或 Edge。可通过 NINTRANSLATE_TEST_BROWSER 指定浏览器。');
  return browser;
}

function renderWithBrowser(browser, testCase, html) {
  const currentPage = path.join(artifactRoot, 'current-test-page.html');
  const currentScreenshot = path.join(artifactRoot, 'current-test-page.png');
  fs.writeFileSync(currentPage, html);
  const result = spawnSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--force-device-scale-factor=1',
    `--user-data-dir=${path.join(artifactRoot, 'chrome-user-data')}`,
    `--window-size=${testCase.style.width},${testCase.style.height}`,
    `--screenshot=${currentScreenshot}`,
    pathToFileURL(currentPage).href
  ], { cwd: projectRoot, encoding: 'utf8', timeout: 60_000 });
  if (result.error) throw result.error;
  if (result.status !== 0 || !fs.existsSync(currentScreenshot)) {
    throw new Error(`浏览器截图失败（代码 ${result.status ?? '未知'}）：${result.stderr || result.stdout}`);
  }
  return fs.readFileSync(currentScreenshot);
}

async function main() {
  const { buildTranslationText } = require(path.join(projectRoot, 'dist-electron', 'main', 'textFlow.js'));
  const browser = findBrowser();
  const sidecar = startSidecar();
  await sidecar.ready;
  const results = [];
  for (const name of ['single-latin', 'single-cjk', 'single-japanese', 'single-cyrillic', 'ruled-list', 'headline-hyphen', 'two-columns']) {
    const oldFailure = path.join(artifactRoot, `${name}.png`);
    if (fs.existsSync(oldFailure)) fs.unlinkSync(oldFailure);
  }
  try {
    for (const testCase of makeCases()) {
      const html = pageHtml(testCase);
      const image = renderWithBrowser(browser, testCase, html);
      const ocr = await sidecar.recognize(`data:image/png;base64,${image.toString('base64')}`);
      const actual = buildTranslationText(ocr.paragraphs, ocr.text, 'smart');
      const expectedComparable = normalize(testCase.expected);
      const actualComparable = normalize(actual);
      const distance = editDistance(expectedComparable, actualComparable);
      const characterAccuracy = 1 - distance / Math.max(1, expectedComparable.length);
      const paragraphsExpected = testCase.expected.split(/\n\n/).length;
      const paragraphsActual = actual.split(/\n\n/).length;
      const passed = characterAccuracy >= 0.97 && paragraphsExpected === paragraphsActual;
      const result = {
        name: testCase.name,
        passed,
        characterAccuracy: Number(characterAccuracy.toFixed(4)),
        expectedParagraphs: paragraphsExpected,
        actualParagraphs: paragraphsActual,
        expected: testCase.expected,
        actual,
        confidence: ocr.confidence,
        layoutElapsedMs: ocr.layoutElapsedMs
      };
      results.push(result);
      console.log(`${passed ? 'PASS' : 'FAIL'} ${testCase.name} | chars ${(characterAccuracy * 100).toFixed(2)}% | paragraphs ${paragraphsActual}/${paragraphsExpected}`);
      const failureScreenshot = path.join(artifactRoot, `${testCase.name}.png`);
      if (!passed || process.env.NINTRANSLATE_OCR_KEEP_SCREENSHOTS === '1') fs.writeFileSync(failureScreenshot, image);
      else if (fs.existsSync(failureScreenshot)) fs.unlinkSync(failureScreenshot);
    }
  } finally {
    sidecar.child.stdin.end();
    sidecar.child.kill();
  }
  const report = { seed, generatedAt: new Date().toISOString(), results };
  fs.writeFileSync(path.join(artifactRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.appendFileSync(path.join(artifactRoot, 'runs.ndjson'), `${JSON.stringify({
    seed,
    generatedAt: report.generatedAt,
    passed: results.every((result) => result.passed),
    cases: results.map(({ name, passed, characterAccuracy, expectedParagraphs, actualParagraphs }) => ({
      name, passed, characterAccuracy, expectedParagraphs, actualParagraphs
    }))
  })}\n`);
  console.log(`Seed: ${seed}`);
  console.log(`Report: ${path.join(artifactRoot, 'report.json')}`);
  if (results.some(({ passed }) => !passed)) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
