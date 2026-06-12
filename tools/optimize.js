// 사용법: node optimize.js <manifest.json>
// manifest: [{url, out, maxW, quality}]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const items = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const it of items) {
    const buf = fs.readFileSync(it.src);
    const b64 = buf.toString('base64');
    const dataUrl = `data:image/png;base64,${b64}`;
    const out = await page.evaluate(async ({ dataUrl, maxW, quality }) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/jpeg', quality);
    }, { dataUrl, maxW: it.maxW, quality: it.quality });
    const jpg = Buffer.from(out.split(',')[1], 'base64');
    fs.writeFileSync(it.out, jpg);
    console.log(`${it.out}: ${(buf.length/1024).toFixed(0)}KB -> ${(jpg.length/1024).toFixed(0)}KB`);
  }
  await browser.close();
})();
