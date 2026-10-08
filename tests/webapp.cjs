// Run with Node.js and Playwright installed: node tests/webapp.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const rows = [['id', 'name', 'price', 'enabled', 'sort'],
  ['rose', 'Роза красная', '200', 'TRUE', '1'],
  ['peony', 'Пион белый', '450', 'TRUE', '2'],
  ['fir', 'Ёлка', '1 250,00', 'TRUE', '3'],
  ['html', '<img src=x onerror=alert(1)>', '100', 'TRUE', '4'],
  ['disabled', 'Скрытый товар', '20', 'FALSE', '5'],
  ['invalid', 'Некорректная цена', '-1', 'TRUE', '6'],
  ['rose', 'Дубликат', '300', 'TRUE', '7'],
  ...Array.from({length: 20}, (_, i) => [`item${i}`, `Товар ${i}`, '50', 'TRUE', String(10 + i)])];

async function main() {
  const root = path.resolve(__dirname, '../webapp');
  const server = http.createServer((req, res) => {
    const name = req.url === '/' ? 'index.html' : req.url.slice(1);
    if (!['index.html', 'app.js', 'config.js', 'styles.css'].includes(name)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(root, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let failSheets = false;
    let currentRows = rows;
    await page.route('https://telegram.org/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
    await page.route('https://sheets.googleapis.com/**', route => route.fulfill({ status: failSheets ? 503 : 200, contentType: 'application/json', body: JSON.stringify({ values: currentRows }) }));
    const url = `http://127.0.0.1:${server.address().port}/`;
    await page.goto(url);
    await page.waitForFunction(() => document.querySelectorAll('.product').length === 24);
    assert.equal(await page.locator('#grid img').count(), 0, 'Sheet content must be rendered as text');
    await page.locator('#search').fill('РОЗА');
    assert.equal(await page.locator('.product').count(), 1);
    await page.locator('#search').fill('елка');
    assert.equal(await page.locator('.product').count(), 1, 'Search normalizes ё');
    await page.locator('#search').fill('peony');
    assert.equal(await page.locator('.product').count(), 1, 'Search matches ID');
    await page.locator('#search').fill('роза крас');
    await page.locator('#grid button[data-action="plus"]').click();
    await page.locator('#grid button[data-action="plus"]').click();
    assert.equal(await page.locator('#total').textContent(), '400 ₽');
    await page.locator('#grid button[data-action="favorite"]').click();
    await page.locator('#reset-search').click();
    await page.locator('[data-filter="favorites"]').click();
    assert.equal(await page.locator('.product').count(), 1);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.product').length === 24);
    assert.equal(await page.locator('#total').textContent(), '400 ₽', 'Draft survives reload');
    assert.equal(await page.locator('.favorite.chosen').count(), 1, 'Favorites survive reload');
    await page.locator('#cart input').fill('5');
    await page.locator('#cart input').press('Tab');
    assert.equal(await page.locator('#total').textContent(), '1 000 ₽');
    await page.locator('#cart input').fill('-1');
    await page.locator('#cart input').press('Tab');
    assert.equal(await page.locator('#cart input').inputValue(), '5', 'Invalid quantity cannot corrupt the draft');
    await page.locator('[data-filter="cart"]').click();
    assert.equal(await page.locator('.product').count(), 1);
    await page.locator('#send').click();
    assert.equal(await page.locator('#review').evaluate(el => el.open), true);
    assert.equal(await page.locator('#confirm-send').isDisabled(), true, 'Browser preview cannot send');
    await page.locator('#review .icon-button').click();
    failSheets = true;
    await page.locator('#refresh').click();
    await page.locator('#retry').waitFor({state:'visible'});
    assert.equal(await page.locator('#total').textContent(), '1 000 ₽', 'Failed refresh preserves the order');
    failSheets = false;
    currentRows = rows.map(row => row[0] === 'rose' && row[1] === 'Роза красная' ? ['rose', 'Роза красная', '250', 'TRUE', '1'] : row);
    await page.locator('#retry').click();
    await page.waitForFunction(() => document.getElementById('total').textContent === '1 250 ₽');
    await page.locator('[data-filter="all"]').click();
    await page.locator('#sort').selectOption('price-desc');
    assert.equal(await page.locator('.product h3').first().textContent(), 'Ёлка');
    await page.locator('#search').fill('нет такого товара');
    assert.equal(await page.locator('.product').count(), 0);
    assert.equal(await page.locator('#catalog-status').isVisible(), true);
    await page.locator('#reset-search').click();
    if (process.env.SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.SCREENSHOT_DIR, {recursive:true});
      await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'desktop.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Mobile view fits the screen');
    if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 320, height: 700 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Narrow mobile view fits the screen');
    await page.locator('#mobile-summary').click();
    assert.equal(await page.locator('#order-title').evaluate(el => { const rect = el.getBoundingClientRect(); return rect.top >= 0 && rect.bottom < window.innerHeight; }), true, 'Mobile summary links to the order');
    await page.addInitScript(() => {
      window.Telegram = { WebApp: { initData: 'test', initDataUnsafe: { user: { id: 123 } }, ready() {}, expand() {}, sendData(value) { window.sentPayload = JSON.parse(value); } } };
    });
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.product').length === 24);
    await page.locator('#search').fill('peony');
    await page.locator('#grid button[data-action="plus"]').click();
    await page.locator('#send').click();
    await page.locator('#confirm-send').click();
    const payload = await page.evaluate(() => window.sentPayload);
    assert.equal(payload.v, 1);
    assert.equal(payload.total, 450);
    assert.deepEqual(payload.items, [{id:'peony',name:'Пион белый',price:450,qty:1}]);
    assert.equal(await page.locator('#confirm-send').isDisabled(), true, 'Repeated send is blocked');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('total').textContent === '450 ₽');
    await page.evaluate(() => { window.Telegram.WebApp.sendData = () => { throw new Error('Mock transport failure'); }; });
    await page.locator('#send').click();
    await page.locator('#confirm-send').click();
    assert.equal(await page.locator('#confirm-send').isDisabled(), false, 'Failed send can be retried');
    assert.match(await page.locator('#send-error').textContent(), /Не удалось отправить/);
    await page.locator('#review .icon-button').click();
    currentRows = rows.filter(row => row[0] !== 'peony');
    await page.locator('#refresh').click();
    await page.waitForFunction(() => document.getElementById('total').textContent === '0 ₽');
    assert.equal(await page.locator('#send').isDisabled(), true, 'Unavailable items are removed');
    currentRows = [rows[0], ['large', 'Большой букет '.repeat(400), '100', 'TRUE', '1']];
    await page.locator('#refresh').click();
    await page.waitForFunction(() => document.querySelectorAll('.product').length === 1);
    await page.locator('#grid button[data-action="plus"]').click();
    await page.locator('#send').click();
    await page.locator('#confirm-send').click();
    assert.match(await page.locator('#send-error').textContent(), /слишком большой/);
    await page.locator('#review .icon-button').click();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#clear').click();
    assert.equal(await page.locator('#total').textContent(), '0 ₽');
    failSheets = true;
    await page.reload();
    await page.locator('#retry').waitFor({state:'visible'});
    assert.equal(await page.locator('.product').count(), 0);
    failSheets = false;
    currentRows = rows;
    await page.locator('#retry').click();
    await page.waitForFunction(() => document.querySelectorAll('.product').length === 24);
    assert.deepEqual(errors, []);
    console.log('PASS: catalog, search, sorting, favorites, draft, quantities, refresh, safe rendering, mobile layout, and Telegram payload. No real orders sent.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
