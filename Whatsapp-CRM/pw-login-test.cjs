const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');

function buildScreenshotPath(fileName) {
  const dir = process.env.PW_SCREENSHOT_DIR || os.tmpdir();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, fileName);
}

async function findInputByAttributes(inputs, { type, matcher }) {
  for (const input of inputs) {
    const inputType = (await input.getAttribute('type')) || 'text';
    const name = (await input.getAttribute('name')) || '';
    const id = (await input.getAttribute('id')) || '';
    const placeholder = (await input.getAttribute('placeholder')) || '';
    const ariaLabel = (await input.getAttribute('aria-label')) || '';
    const haystack = `${inputType} ${name} ${id} ${placeholder} ${ariaLabel}`.toLowerCase();

    if (type && inputType !== type) continue;
    if (matcher.test(haystack)) return input;
  }

  return null;
}

(async () => {
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });

    console.log('Navigating to /v2/login...');
    await page.goto('http://localhost:3000/v2/login', { waitUntil: 'networkidle', timeout: 60000 });
    await page.screenshot({ path: buildScreenshotPath('v2-login-fresh.png') });
    console.log('Login page screenshot saved');

    const inputs = await page.$$('input');
    console.log('Input count:', inputs.length);
    for (const inp of inputs) {
      const type = await inp.getAttribute('type');
      const name = await inp.getAttribute('name');
      const placeholder = await inp.getAttribute('placeholder');
      console.log('  input type=' + type + ' name=' + name + ' placeholder=' + placeholder);
    }

    const loginEmail = process.env.PW_LOGIN_EMAIL || 'test@example.com';
    const loginPassword = process.env.PW_LOGIN_PASSWORD || '';
    const emailInput = await findInputByAttributes(inputs, { matcher: /email|phone|username/i });
    const passwordInput = await findInputByAttributes(inputs, { type: 'password', matcher: /password/i });

    if (emailInput) {
      await emailInput.fill(loginEmail);
      console.log('Email input filled');
    }
    if (passwordInput) {
      await passwordInput.fill(loginPassword);
      console.log('Password input filled');
    }

    await page.screenshot({ path: buildScreenshotPath('v2-login-filled.png') });

    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
      console.log('Submit clicked');
    }

    await page.waitForTimeout(12000);
    console.log('URL after submit:', page.url());
    await page.screenshot({ path: buildScreenshotPath('v2-after-login.png') });
    console.log('After-login screenshot saved');
  } catch (error) {
    console.error('ERROR:', error.message);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
