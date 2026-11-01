/* Full-resolution local design outputs. Only previews are reduced. */
(function (global) {
  'use strict';
  const MAX_PIXELS = 40000000, MAX_SIDE = 32767;
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const luminance = c => .2126 * c.r + .7152 * c.g + .0722 * c.b;
  const pause = () => new Promise(resolve => setTimeout(resolve, 0));
  function validateSize(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
      throw Error('目标图片超过浏览器处理范围（4000万像素，单边32767像素）。请降低补全倍数，或自行缩小原图后重试；不会自动降低分辨率。');
    }
  }
  function canvas(width, height) {
    validateSize(width, height);
    const element = document.createElement('canvas'); element.width = width; element.height = height;
    const context = element.getContext('2d', { willReadFrequently: true });
    if (!context) throw Error('无法创建绘图画布，请缩小图片后重试');
    return { element, context };
  }
  function load(src) {
    return new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image);
      image.onerror = () => reject(Error('图片无法读取，请更换图片后重试')); image.src = src;
    });
  }
  function encode(element) {
    const url = element.toDataURL('image/png');
    if (!url.startsWith('data:image/png')) throw Error('浏览器无法导出完整图片，请缩小图片后重试');
    return url;
  }
  function preview(image) {
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    const scale = Math.min(1, 640 / Math.max(width, height));
    const { element, context } = canvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    try { context.drawImage(image, 0, 0, element.width, element.height); return encode(element); }
    finally { element.width = element.height = 0; }
  }
  async function thumbnail(src) { return preview(await load(src)); }
  const palettes = { smoked: { r: 91, g: 70, b: 57 }, warmGrey: { r: 139, g: 128, b: 112 }, lightNatural: { r: 201, g: 178, b: 142 }, redBrown: { r: 132, g: 70, b: 49 } };
  async function twin(src, style, strength) {
    const image = await load(src), width = image.naturalWidth, height = image.naturalHeight;
    const { element, context } = canvas(width, height), results = [];
    try {
      context.drawImage(image, 0, 0);
      const original = context.getImageData(0, 0, width, height), target = palettes[style] || palettes.smoked, targetLight = luminance(target), targetChannels = [target.r, target.g, target.b];
      for (const multiplier of [.56, .76, .94]) {
        const output = context.createImageData(width, height), amount = clamp(strength / 100 * multiplier, .15, .95);
        for (let row = 0; row < height; row += 32) {
          const end = Math.min(height, row + 32) * width * 4;
          for (let i = row * width * 4; i < end; i += 4) {
            const r = original.data[i], g = original.data[i + 1], b = original.data[i + 2];
            const light = .2126 * r + .7152 * g + .0722 * b, ratio = clamp((light + 24) / (targetLight + 24), .35, 1.85), contrast = clamp((light - 128) * 1.06 + 128, 0, 255);
            for (let offset = 0; offset < 3; offset++) {
              const mapped = clamp(targetChannels[offset] * ratio + (contrast - light) * .28, 0, 255);
              output.data[i + offset] = Math.round(original.data[i + offset] * (1 - amount) + mapped * amount);
            }
            output.data[i + 3] = original.data[i + 3];
          }
          await pause();
        }
        context.putImageData(output, 0, 0);
        let similarity = null, similarityError = '';
        try { similarity = await global.DilongCompareCore.structureSimilarity(original, output); }
        catch (error) { similarityError = error.message; }
        results.push({ url: encode(element), thumbnailUrl: preview(element), width, height, similarity, similarityError });
      }
      return results;
    } finally { element.width = element.height = 0; }
  }
  async function complete(src, mode) {
    const image = await load(src), w = image.naturalWidth, h = image.naturalHeight;
    const around = mode === 'around', columns = mode === 'horizontal5' ? 5 : 3, rows = around ? 3 : 1;
    const width = w * columns, height = h * rows;
    validateSize(width, height);
    const results = [];
    for (let variant = 0; variant < 3; variant++) {
      const { element, context } = canvas(width, height);
      try {
        let seed = 73 + variant * 97;
        const random = () => ((seed = seed * 16807 % 2147483647) - 1) / 2147483646;
        const strip = Math.max(1, Math.round(w * [68, 52, 82][variant] / 300));
        const overlap = Math.min(strip - 1, Math.round(w * 16 / 300)), step = strip - overlap;
        const tileHeight = around ? Math.max(1, Math.round(h * .48)) : h;
        for (let y = 0; y < height; y += around ? Math.max(1, Math.round(h * .42)) : h) {
          for (let x = -overlap; x < width; x += step) {
            const sx = Math.floor(random() * Math.max(1, w - strip)), sy = around ? Math.floor(random() * Math.max(1, h - tileHeight)) : 0;
            context.save(); context.globalAlpha = x <= 0 ? 1 : .88;
            context.drawImage(image, sx, sy, strip, tileHeight, x, y, strip, tileHeight);
            const gradient = context.createLinearGradient(x, y, x + strip, y);
            gradient.addColorStop(0, 'rgba(255,255,255,.12)'); gradient.addColorStop(.22, 'rgba(255,255,255,0)'); gradient.addColorStop(1, 'rgba(0,0,0,.025)');
            context.fillStyle = gradient; context.fillRect(x, y, strip, tileHeight); context.restore();
          }
          await pause();
        }
        // Preserve the input at its original pixel scale in the center.
        context.clearRect(Math.floor(columns / 2) * w, Math.floor(rows / 2) * h, w, h);
        context.drawImage(image, Math.floor(columns / 2) * w, Math.floor(rows / 2) * h);
        results.push({ url: encode(element), thumbnailUrl: preview(element), width, height });
      } finally { element.width = element.height = 0; }
    }
    return results;
  }
  function scoreLabel(value) { return Number.isFinite(value) ? '结构相似度 ' + (clamp(value, 0, 1) * 100).toFixed(1) + '%' : '结构相似度：暂无法计算'; }
  global.DilongDesignImages = { twin, complete, thumbnail, scoreLabel, validateSize };
})(window);
