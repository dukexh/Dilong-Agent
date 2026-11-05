import type { RGB, InkRecipe, InkRenderModel, InkResult, ImageSummary } from './types'
import { DesignImages } from './design-images'

const ll = (e: number, t: number, n: number) => Math.max(t, Math.min(n, e));
const ul = (e: RGB) => .2126 * e.r + .7152 * e.g + .0722 * e.b;
const dl = (e: RGB, t: RGB) => (e.r - t.r) ** 2 + (e.g - t.g) ** 2 + (e.b - t.b) ** 2;
var fl = ({
  r: e,
  g: t,
  b: n
}: RGB) => `#${[e, t, n].map(e => Math.round(e).toString(16).padStart(2, `0`)).join(``)}`.toUpperCase();
function pl({
  r: e,
  g: t,
  b: n
}: RGB): InkRecipe {
  let r = e / 255,
    i = t / 255,
    a = n / 255,
    o = 1 - Math.max(r, i, a),
    s = Math.max(r, i, a) - Math.min(r, i, a),
    c = {
      red: Math.max(.03, r - i + Math.max(0, r - a) * .35),
      yellow: Math.max(.03, Math.min(r, i) - a + Math.max(0, i - a) * .3),
      blue: Math.max(.018, a - Math.min(r, i) + Math.max(0, r + a - 2 * i) * .18),
      black: Math.max(.025, o * .75 + (1 - s) * o * .35)
    },
    l = ll(20 + o * 57 + s * 15, 20, 76),
    u = Object.values(c).reduce((e, t) => e + t, 0),
    d = Math.round(c.red / u * l),
    f = Math.round(c.yellow / u * l),
    p = Math.round(c.blue / u * l),
    m = Math.round(c.black / u * l);
  return {
    red: d,
    yellow: f,
    blue: p,
    black: m,
    thinner: 100 - d - f - p - m
  };
}
function ml(e: RGB, t: RGB[]): number {
  let n = 0,
    r = 1 / 0;
  return t.forEach((t, i) => {
    let a = dl(e, t);
    a < r && (r = a, n = i);
  }), n;
}
export function renderInk(e: InkRenderModel, t: boolean[]): string {
  let n = document.createElement(`canvas`);
  n.width = e.width, n.height = e.height;
  let r = n.getContext(`2d`);
  if (!r) return ``;
  let i = r.createImageData(e.width, e.height);
  for (let n = 0; n < e.assignments.length; n++) {
    if (e.original[n * 4 + 3] <= (e.alphaThreshold ?? 220)) continue;
    let r = e.assignments[n],
      a = -1;
    for (let e = r; e >= 0; e--) if (t[e]) {
      a = e;
      break;
    }
    let o = n * 4;
    if (a >= 0) {
      let t = e.colours[a];
      i.data[o] = t.r, i.data[o + 1] = t.g, i.data[o + 2] = t.b, i.data[o + 3] = e.original[o + 3];
    }
  }
  return r.putImageData(i, 0, 0), n.toDataURL(`image/png`);
}
export function analyzeInk(e: HTMLImageElement): InkResult {
  let t = Math.min(1, 720 / e.naturalWidth, 520 / e.naturalHeight),
    n = Math.max(1, Math.round(e.naturalWidth * t)),
    r = Math.max(1, Math.round(e.naturalHeight * t)),
    pixels = DesignImages.analysisImageData(e, n, r);
  n = pixels.width;
  r = pixels.height;
  let o = pixels.data,
    s: RGB[] = [],
    c = Math.max(2, Math.round(Math.sqrt(n * r / 16e3)));
  for (let e = 0; e < r; e += c) for (let t = 0; t < n; t += c) {
    let r = (e * n + t) * 4;
    o[r + 3] > 0 && s.push({
      r: o[r],
      g: o[r + 1],
      b: o[r + 2]
    });
  }
  if (!s.length) for (let k = 0; k < o.length; k += 4) {
    if (o[k + 3] > 0) s.push({
      r: o[k],
      g: o[k + 1],
      b: o[k + 2]
    });
  }
  let l = 255,
    u = 0;
  s.forEach(e => {
    let t = ul(e);
    l = Math.min(l, t), u = Math.max(u, t);
  });
  let d = u - l,
    f = d < 28 ? 2 : d < 62 ? 3 : 4,
    p = [...s].sort((e, t) => ul(e) - ul(t)),
    m = Array.from({
      length: f
    }, (e, t) => ({
      ...p[Math.floor((t + 0.5) / f * (p.length - 1))]
    }));
  for (let e = 0; e < 12; e++) {
    let e = Array.from({
      length: f
    }, () => ({
      r: 0,
      g: 0,
      b: 0,
      n: 0
    }));
    s.forEach(t => {
      let n = ml(t, m);
      e[n].r += t.r, e[n].g += t.g, e[n].b += t.b, e[n].n++;
    }), m = m.map((t, n) => e[n].n ? {
      r: e[n].r / e[n].n,
      g: e[n].g / e[n].n,
      b: e[n].b / e[n].n
    } : t);
  }
  m = [...m].sort((e, t) => ul(t) - ul(e));
  let h = new Uint8Array(n * r),
    g = Array<number>(f).fill(0),
    _ = 0,
    validCount = 0;
  for (let e = 0; e < n * r; e++) {
    let t = e * 4;
    if (o[t + 3] <= 0) continue;
    validCount++;
    let n = {
        r: o[t],
        g: o[t + 1],
        b: o[t + 2]
      },
      r = ml(n, m);
    h[e] = r, g[r]++, _ += Math.sqrt(dl(n, m[r]));
  }
  let v: Record<number, string[][]> = {
      2: [[`大底色`, `整体基调与承印底色`], [`主纹理色`, `主木纹与结构`]],
      3: [[`大底色`, `整体基调与承印底色`], [`浅纹理色`, `柔和明暗变化`], [`主纹理色`, `主木纹与结构`]],
      4: [[`大底色`, `整体基调与承印底色`], [`浅纹理色`, `柔和明暗变化`], [`主纹理色`, `主木纹与山纹`], [`深纹理色`, `木眼、节疤与细纹`]]
    },
    y = {
      width: n,
      height: r,
      assignments: h,
      colours: m,
      original: o,
      alphaThreshold: 0
    };
  return {
    layers: m.map((e, t) => {
      let i = document.createElement(`canvas`);
      i.width = n, i.height = r;
      let a = i.getContext(`2d`),
        o = a!.createImageData(n, r);
      for (let n = 0; n < h.length; n++) if (y.original[n * 4 + 3] > 0 && (t === 0 || h[n] === t)) {
        let r = n * 4;
        o.data[r] = e.r, o.data[r + 1] = e.g, o.data[r + 2] = e.b, o.data[r + 3] = Math.min(y.original[r + 3], t === 0 ? 255 : 235);
      }
      return a!.putImageData(o, 0, 0), {
        name: v[f][t][0],
        role: v[f][t][1],
        rgb: e,
        hex: fl(e),
        share: Math.round(g[t] / validCount * 100),
        recipe: pl(e),
        maskUrl: i.toDataURL(`image/png`)
      };
    }),
    renderModel: y,
    reconstructionUrl: renderInk(y, Array(f).fill(!0)),
    difference: Math.round(_ / validCount / Math.sqrt(3))
  };
}
export function analyzeSummary(e: string | HTMLImageElement): Promise<ImageSummary> {
  return new Promise<ImageSummary>((t, n) => {
    const r = typeof e === 'string' ? new Image() : e;
    const analyze = () => {
      try {
        DesignImages.validateSize(r.naturalWidth, r.naturalHeight);
        const pixels = DesignImages.analysisImageData(r, 120, 90);
        const width = pixels.width,
          height = pixels.height;
        let a = pixels.data,
          o = 0,
          s = 0,
          c = 0,
          l = 0,
          u = 0,
          validCount = 0;
        for (let e = 0; e < height; e++) for (let t = 0; t < width; t++) {
          let n = (e * width + t) * 4;
          if (a[n + 3] <= 0) continue;
          validCount++;
          if (o += a[n], s += a[n + 1], c += a[n + 2], t > 0 && a[n - 1] > 0) {
            let e = n - 4;
            l += Math.abs(a[n] - a[e]) + Math.abs(a[n + 1] - a[e + 1]) + Math.abs(a[n + 2] - a[e + 2]), u += 3;
          }
          if (e > 0 && a[n - width * 4 + 3] > 0) {
            let e = n - width * 4;
            l += Math.abs(a[n] - a[e]) + Math.abs(a[n + 1] - a[e + 1]) + Math.abs(a[n + 2] - a[e + 2]), u += 3;
          }
        }
        if (!validCount) throw Error(`图片没有可分析的有效颜色`);
        let d = validCount,
          f = {
            r: Math.round(o / d),
            g: Math.round(s / d),
            b: Math.round(c / d)
          };
        t({
          averageRgb: f,
          brightness: Math.round((f.r + f.g + f.b) / 3),
          textureDensity: Math.round(ll(l / Math.max(1, u) / 255 * 520, 0, 100))
        });
      } catch (error) {
        n(error);
      }
    };
    if (typeof e === 'string') {
      r.onload = analyze;
      r.onerror = () => n(Error(`图片读取失败`));
      r.src = e;
    } else analyze();
  });
}
analyzeSummary.acceptsDecodedImage = true
export { ll as clamp, fl as rgbToHex, pl as predictRecipe }
