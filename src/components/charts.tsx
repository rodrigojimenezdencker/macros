import { useState, type ReactNode } from 'react';
import { useWidth } from '../hooks';
import { fmt, fmtKcal, fmtKg } from '../lib/nutrition';
import { relativeLabel, shortLabel, weekdayInitial } from '../lib/dates';
import { MACROS, Swatch } from './Macros';

/** Round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max <= min) max = min + 1;
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  // Huge magnitudes lose the precision to step at all; don't loop on them.
  if (!(step > 0) || !Number.isFinite(start) || start + step === start) return [min, max];
  // Build by index (never by accumulating floats), with a hard cap.
  const n = Math.min(count * 3, Math.ceil((max - start) / step - 1e-9) + 1);
  return Array.from({ length: n }, (_, i) => Math.round((start + i * step) * 1000) / 1000);
}

const compact = (v: number) => (v >= 1000 ? `${fmt(v / 1000)}K` : fmt(v));

/** Path for a rect with rounded top corners and a square base. */
function topRounded(x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  // Keep the tooltip inside the chart: flip to the left of the pointer near the right edge.
  const right = x > width * 0.6;
  return (
    <div className="chart-tip" style={right ? { right: width - x + 10 } : { left: x + 10 }}>
      {children}
    </div>
  );
}

const PAD = { top: 12, right: 12, bottom: 26, left: 38 };
const PLOT_H = 170;

export interface DayStat {
  date: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Calories from entries with no macros at all (quick-adds with only kcal). */
  unattributed: number;
}

/**
 * Daily calories as stacked columns, split by each macro's share of energy
 * (protein/carbs at 4 kcal/g, fat at 9). Each column's height is always the
 * logged total; calories from entries without macros form a grey segment.
 */
export function CaloriesChart({ days, goal }: { days: DayStat[]; goal: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const n = days.length;
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const maxV = Math.max(goal * 1.1, ...days.map((d) => d.kcal), 100);
  const ticks = niceTicks(0, maxV, 4);
  const top = ticks[ticks.length - 1];
  const y = (v: number) => PAD.top + PLOT_H - (v / top) * PLOT_H;
  const band = n ? innerW / n : 0;
  const barW = Math.max(2, Math.min(24, band * 0.62));
  const labelEvery = n <= 7 ? 1 : n <= 31 ? 7 : 15;
  const hasOther = days.some((d) => d.unattributed > 0);

  const segments = (d: DayStat) => {
    const parts = [d.protein * 4, d.carbs * 4, d.fat * 9];
    const macroK = parts[0] + parts[1] + parts[2];
    const attributed = Math.max(0, d.kcal - d.unattributed);
    // Label calories rarely equal 4/4/9 exactly, so split by share rather than by raw energy.
    if (macroK <= 0) return [0, 0, 0, d.kcal];
    return [...parts.map((p) => (p / macroK) * attributed), d.kcal - attributed];
  };
  const classes = ['protein', 'carbs', 'fat', 'other'];

  const activeDay = active !== null ? days[active] : null;

  return (
    <figure className="chart">
      <div className="chart-box" ref={ref} onPointerLeave={() => setActive(null)}>
        {width > 0 && (
          <svg width={width} height={PAD.top + PLOT_H + PAD.bottom} role="img" aria-label="Calorías por día">
            {ticks.map((t) => (
              <g key={t}>
                <line className={t === 0 ? 'axis' : 'grid'} x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
                <text className="tick" x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
                  {compact(t)}
                </text>
              </g>
            ))}
            {days.map((d, i) => {
              const cx = PAD.left + band * i + band / 2;
              const x = cx - barW / 2;
              const segs = segments(d);
              const lastVisible = segs.reduce((acc, v, j) => (v > 0 ? j : acc), -1);
              let acc = 0;
              return (
                <g
                  key={d.date}
                  className={`col${active === i ? ' active' : ''}${active !== null && active !== i ? ' dim' : ''}`}
                  tabIndex={0}
                  aria-label={`${relativeLabel(d.date)}: ${fmtKcal(d.kcal)} kcal`}
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                >
                  <rect className="hit" x={PAD.left + band * i} y={PAD.top} width={band} height={PLOT_H} />
                  {segs.map((v, j) => {
                    if (v <= 0) return null;
                    const y0 = y(acc);
                    acc += v;
                    const y1 = y(acc);
                    // 2px surface gap below every segment that sits on another (skipped when too thin to show).
                    const gap = acc > v && y0 - y1 > 3 ? 2 : 0;
                    const h = Math.max(0.5, y0 - y1 - gap);
                    return j === lastVisible ? (
                      <path key={j} className={`seg seg-${classes[j]}`} d={topRounded(x, y1, barW, h, 4)} />
                    ) : (
                      <rect key={j} className={`seg seg-${classes[j]}`} x={x} y={y1} width={barW} height={h} />
                    );
                  })}
                  {i % labelEvery === (n - 1) % labelEvery && (
                    <text className="tick" x={cx} y={PAD.top + PLOT_H + 17} textAnchor="middle">
                      {n <= 7 ? weekdayInitial(d.date) : shortLabel(d.date)}
                    </text>
                  )}
                </g>
              );
            })}
            {goal > 0 && (
              <g className="goal-line" pointerEvents="none">
                <line x1={PAD.left} x2={width - PAD.right} y1={y(goal)} y2={y(goal)} />
                <text x={width - PAD.right} y={y(goal) - 5} textAnchor="end">
                  Objetivo {fmtKcal(goal)}
                </text>
              </g>
            )}
          </svg>
        )}
        {activeDay && active !== null && (
          <Tooltip x={PAD.left + band * active + band / 2} width={width}>
            <div className="tip-title">{relativeLabel(activeDay.date)}</div>
            <div className="tip-main">
              <strong>{fmtKcal(activeDay.kcal)}</strong> kcal
            </div>
            {MACROS.map((m) => (
              <div className="tip-row" key={m.key}>
                <span className={`line-key key-${m.key}`} />
                <strong>{fmt(activeDay[m.key])} g</strong> {m.label}
              </div>
            ))}
          </Tooltip>
        )}
      </div>
      <figcaption>
        <ul className="legend legend-inline">
          {MACROS.map((m) => (
            <li key={m.key}>
              <Swatch macro={m.key} />
              {m.label}
            </li>
          ))}
          {hasOther && (
            <li>
              <Swatch macro="other" />
              Sin desglose
            </li>
          )}
        </ul>
      </figcaption>
    </figure>
  );
}

export interface WeightPoint {
  date: string;
  kg: number;
}

/** Weight over the selected range: 2px line, ringed dots, crosshair readout and an end label. */
export function WeightChart({ points, from, to }: { points: WeightPoint[]; from: string; to: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const t0 = new Date(from).getTime();
  const t1 = Math.max(new Date(to).getTime(), t0 + 86400000);
  const innerW = Math.max(0, width - PAD.left - PAD.right - 44); // room for the end label
  const x = (date: string) => PAD.left + ((new Date(date).getTime() - t0) / (t1 - t0)) * innerW;
  const kgs = points.map((p) => p.kg);
  const lo = Math.min(...kgs);
  const hi = Math.max(...kgs);
  const span = Math.max(hi - lo, 1);
  const ticks = niceTicks(lo - span * 0.25, hi + span * 0.25, 4);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const step = ticks[1] - ticks[0];
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const tickLabel = (t: number) => t.toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const y = (v: number) => PAD.top + PLOT_H - ((v - yMin) / (yMax - yMin)) * PLOT_H;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date)},${y(p.kg)}`).join('');
  const last = points[points.length - 1];
  const showDots = points.length <= 31;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const px = e.clientX - box.left;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.date) - px) < Math.abs(x(points[best].date) - px)) best = i;
    });
    setActive(best);
  };

  const xTicks = [from, to];
  const activePoint = active !== null ? points[active] : null;

  return (
    <figure className="chart">
      <div className="chart-box" ref={ref}>
        {width > 0 && points.length > 0 && (
          <svg width={width} height={PAD.top + PLOT_H + PAD.bottom} role="img" aria-label="Evolución del peso">
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid" x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} />
                <text className="tick" x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
                  {tickLabel(t)}
                </text>
              </g>
            ))}
            <line className="axis" x1={PAD.left} x2={PAD.left + innerW} y1={PAD.top + PLOT_H} y2={PAD.top + PLOT_H} />
            {xTicks.map((d, i) => (
              <text key={d} className="tick" x={i ? PAD.left + innerW : PAD.left} y={PAD.top + PLOT_H + 17} textAnchor={i ? 'end' : 'start'}>
                {shortLabel(d)}
              </text>
            ))}
            {activePoint && (
              <line className="crosshair" x1={x(activePoint.date)} x2={x(activePoint.date)} y1={PAD.top} y2={PAD.top + PLOT_H} />
            )}
            <path className="weight-line" d={path} />
            {points.map((p, i) =>
              showDots || i === points.length - 1 || i === active ? (
                <circle key={p.date} className={`weight-dot${i === active ? ' active' : ''}`} cx={x(p.date)} cy={y(p.kg)} r={4} />
              ) : null,
            )}
            <text className="end-label" x={x(last.date) + 9} y={y(last.kg)} dy="0.32em">
              {fmtKg(last.kg)} kg
            </text>
            <rect
              className="hit"
              x={PAD.left}
              y={PAD.top}
              width={innerW}
              height={PLOT_H}
              onPointerMove={onMove}
              onPointerDown={onMove}
              onPointerLeave={() => setActive(null)}
            />
          </svg>
        )}
        {activePoint && active !== null && (
          <Tooltip x={x(activePoint.date)} width={width}>
            <div className="tip-title">{relativeLabel(activePoint.date)}</div>
            <div className="tip-main">
              <strong>{fmtKg(activePoint.kg)}</strong> kg
            </div>
          </Tooltip>
        )}
      </div>
    </figure>
  );
}
