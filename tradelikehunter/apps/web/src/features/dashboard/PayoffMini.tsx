import { portfolioExpiryPnl, type Leg } from '@tlh/domain';
import { useEffect, useRef } from 'react';

/** Expiry payoff of a book, drawn from the real engine onto a canvas. */
export function PayoffMini({ legs, spot, height = 160 }: { legs: Leg[]; spot: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      return; // no 2D context (e.g. jsdom in tests)
    }
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const w = canvas.clientWidth || 600;
    const h = height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const cssv = (v: string) => `rgb(${getComputedStyle(document.documentElement).getPropertyValue(v).trim()})`;
    const brand = cssv('--brand');
    const profit = cssv('--profit');
    const loss = cssv('--loss');
    const border = cssv('--border');

    const lo = spot * 0.9;
    const hi = spot * 1.1;
    const n = 160;
    const xs: number[] = [];
    const ys: number[] = [];
    let ymin = Infinity;
    let ymax = -Infinity;
    for (let i = 0; i <= n; i++) {
      const x = lo + ((hi - lo) * i) / n;
      const y = portfolioExpiryPnl(legs, x);
      xs.push(x);
      ys.push(y);
      if (y < ymin) ymin = y;
      if (y > ymax) ymax = y;
    }
    const pad = (ymax - ymin) * 0.12 || 1;
    ymin -= pad;
    ymax += pad;

    const px = (x: number) => 8 + ((x - lo) / (hi - lo)) * (w - 16);
    const py = (y: number) => 8 + (1 - (y - ymin) / (ymax - ymin)) * (h - 16);
    const zeroY = py(0);

    ctx.clearRect(0, 0, w, h);
    // zero line
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8, zeroY);
    ctx.lineTo(w - 8, zeroY);
    ctx.stroke();

    // area under curve, split at zero
    const drawArea = (above: boolean) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(px(xs[0] as number), zeroY);
      for (let i = 0; i < xs.length; i++) ctx.lineTo(px(xs[i] as number), py(ys[i] as number));
      ctx.lineTo(px(xs[xs.length - 1] as number), zeroY);
      ctx.closePath();
      ctx.clip();
      ctx.beginPath();
      if (above) ctx.rect(0, 0, w, zeroY);
      else ctx.rect(0, zeroY, w, h - zeroY);
      ctx.fillStyle = above ? profit : loss;
      ctx.globalAlpha = 0.16;
      ctx.fill();
      ctx.restore();
    };
    drawArea(true);
    drawArea(false);

    // expiry curve
    ctx.strokeStyle = brand;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < xs.length; i++) {
      const X = px(xs[i] as number);
      const Y = py(ys[i] as number);
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    }
    ctx.stroke();

    // spot marker
    ctx.strokeStyle = cssv('--faint');
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(px(spot), 8);
    ctx.lineTo(px(spot), h - 8);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  return <canvas ref={ref} style={{ width: '100%', height }} aria-label="Portfolio payoff at expiry" />;
}
