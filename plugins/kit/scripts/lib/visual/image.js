'use strict';
// Сравнение PNG как в прототипе: разный размер добивается белым до общего, pixelmatch с threshold 0.1 без AA.
// Библиотеки передаются аргументом: рабочие — из <дом>/deps (home.loadImageLibs), в тестах — из node_modules репозитория.

function padTo(PNG, img, w, h) {
  if (img.width === w && img.height === h) return img;
  const out = new PNG({ width: w, height: h });
  out.data.fill(255);
  PNG.bitblt(img, out, 0, 0, Math.min(img.width, w), Math.min(img.height, h), 0, 0);
  return out;
}

// → { pct: доля отличающихся пикселей в %, 3 знака; size: 'ш×в → ш×в'; changed: число пикселей; diff: PNG-буфер }.
function diffPng(bufA, bufB, { PNG, pixelmatch }) {
  const a = PNG.sync.read(bufA);
  const b = PNG.sync.read(bufB);
  const w = Math.max(a.width, b.width);
  const h = Math.max(a.height, b.height);
  const pa = padTo(PNG, a, w, h);
  const pb = padTo(PNG, b, w, h);
  const diff = new PNG({ width: w, height: h });
  const changed = pixelmatch(pa.data, pb.data, diff.data, w, h, { threshold: 0.1, includeAA: false });
  return {
    pct: +((100 * changed) / (w * h)).toFixed(3),
    size: `${a.width}×${a.height} → ${b.width}×${b.height}`,
    changed,
    diff: PNG.sync.write(diff),
  };
}

module.exports = { padTo, diffPng };
