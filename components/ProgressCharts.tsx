"use client";

/**
 * The progress charts.
 *
 * Colour choices are not taste. The four series hues are slots 1-4 of a
 * palette checked with a colour-vision-deficiency validator: worst adjacent
 * CVD separation 11.8 (light) / 11.1 (dark) and worst normal-vision
 * separation 23.8 / 21.1, both clear of the floors. Dark mode uses the same
 * hues re-stepped for a dark surface, not an automatic inversion. Three of the
 * light steps sit below 3:1 contrast against white, which is why the table
 * view below the charts is mandatory rather than a nicety.
 *
 * Deliberately NOT a dual-axis chart. Every series is a band on the same 1-9
 * scale, so one y axis is correct and a second would invent a comparison.
 *
 * Pronunciation gets its own chart because it is an indicator rather than a
 * band, and putting it on the same axes would imply it is as trustworthy as
 * the other three.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartDataset,
  type Plugin,
} from "chart.js";
import type { ScorePoint } from "@/lib/db/progress";
import type { ActivityDay, PromptWindow } from "@/lib/db/progress";
import { DAY_SHORT_FORMAT, DATE_TIME_FORMAT } from "@/lib/time";

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
);

/** Fewer points than this and a trend line says more than the data supports. */
const MIN_POINTS_FOR_TREND = 3;

type Theme = { text: string; muted: string; grid: string; surface: string };

const SERIES = {
  overall: { label: "Overall", light: "#257de0", dark: "#338ced" },
  fluency: { label: "Fluency", light: "#f47230", dark: "#e76624" },
  lexical: { label: "Lexical", light: "#00b894", dark: "#00a888" },
  grammar: { label: "Grammar", light: "#f2a600", dark: "#d28e05" },
  pronunciation: {
    label: "Pronunciation (indicator)",
    light: "#ee7fac",
    dark: "#e24d8b",
  },
} as const;

const LIGHT: Theme = {
  text: "#191919",
  muted: "#666666",
  grid: "rgba(25,25,25,0.10)",
  surface: "#ffffff",
};
const DARK: Theme = {
  text: "#efefef",
  muted: "#9c9c9c",
  grid: "rgba(239,239,239,0.14)",
  surface: "#191919",
};

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToColorScheme(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Tracks the OS colour scheme so the chart is re-stepped for dark mode rather
 * than inverted.
 *
 * useSyncExternalStore rather than useEffect + setState: matchMedia is an
 * external store, and reading it in an effect would render one frame with the
 * wrong palette and then repaint.
 */
function usePrefersDark(): boolean {
  return useSyncExternalStore(
    subscribeToColorScheme,
    () => window.matchMedia(DARK_QUERY).matches,
    // The server cannot know the viewer's scheme; light is the safe guess and
    // the first client render corrects it.
    () => false,
  );
}

/**
 * Vertical rules where the examiner prompt changed.
 *
 * Written inline rather than pulling in chartjs-plugin-annotation: one dashed
 * line and a label is not worth a second dependency.
 */
function promptMarkerPlugin(
  boundaries: Array<{ index: number; version: string }>,
  theme: Theme,
): Plugin<"line"> {
  return {
    id: "promptMarkers",
    afterDatasetsDraw(chart) {
      const x = chart.scales.x;
      const area = chart.chartArea;
      if (!x) return;
      const context = chart.ctx;
      for (const boundary of boundaries) {
        const position = x.getPixelForValue(boundary.index);
        if (position < area.left || position > area.right) continue;
        context.save();
        context.beginPath();
        context.setLineDash([4, 4]);
        context.lineWidth = 1.5;
        context.strokeStyle = theme.muted;
        context.moveTo(position, area.top);
        context.lineTo(position, area.bottom);
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = theme.muted;
        context.font = "10px system-ui, sans-serif";
        context.textAlign = "left";
        context.fillText(`prompt ${boundary.version}`, position + 3, area.top + 10);
        context.restore();
      }
    },
  };
}

function bandWindow(values: number[]): { min: number; max: number } {
  if (values.length === 0) return { min: 4, max: 9 };
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  return {
    min: Math.max(1, Math.floor(lowest - 0.5)),
    max: Math.min(9, Math.ceil(highest + 0.5)),
  };
}

export default function ProgressCharts({
  series,
  activity,
  promptVersions,
}: {
  series: ScorePoint[];
  activity: ActivityDay[];
  promptVersions: PromptWindow[];
}) {
  const prefersDark = usePrefersDark();
  const theme = prefersDark ? DARK : LIGHT;
  const key = prefersDark ? "dark" : "light";

  const labels = useMemo(
    () => series.map((point) => DAY_SHORT_FORMAT.format(new Date(point.createdAt))),
    [series],
  );

  /** Where the prompt version differs from the previous answer. */
  const boundaries = useMemo(() => {
    const found: Array<{ index: number; version: string }> = [];
    series.forEach((point, index) => {
      if (index > 0 && point.promptVersion !== series[index - 1].promptVersion) {
        found.push({ index, version: point.promptVersion });
      }
    });
    return found;
  }, [series]);

  const enoughData = series.length >= MIN_POINTS_FOR_TREND;

  return (
    <>
      <section className="card">
        <h2>Estimated bands over time</h2>
        <p className="estimate-note">
          AI estimates, not official IELTS bands.
        </p>
        <p className="muted">
          Lines are a 5-answer moving average, so one unusual answer does not
          swing the trend. Individual answers are in the table below.
        </p>

        {enoughData ? (
          <>
            <ScoreChart
              key={`scores-${key}`}
              labels={labels}
              series={series}
              theme={theme}
              prefersDark={prefersDark}
              boundaries={boundaries}
            />
            {boundaries.length > 0 ? (
              <p className="alert alert--soft">
                The dashed lines mark a change to the examiner prompt. Scores
                either side were produced by different instructions and may not
                be directly comparable.
              </p>
            ) : null}
          </>
        ) : (
          <NotEnoughData count={series.length} />
        )}
      </section>

      <section className="card">
        <h2>Pronunciation indicator</h2>
        <p className="estimate-note">
          Indicator only, not a band &mdash; and the least reliable of the four
          scores. Answers with no usable audio are left out of this line.
        </p>
        {enoughData ? (
          <PronunciationChart
            key={`pron-${key}`}
            labels={labels}
            series={series}
            theme={theme}
            prefersDark={prefersDark}
          />
        ) : (
          <NotEnoughData count={series.length} />
        )}
      </section>

      <section className="card">
        <h2>Answers per day</h2>
        {activity.length > 0 ? (
          <ActivityChart
            key={`activity-${key}`}
            activity={activity}
            theme={theme}
            prefersDark={prefersDark}
          />
        ) : (
          <p className="muted">No practice recorded yet.</p>
        )}
      </section>

      <ScoreTable series={series} promptVersions={promptVersions} />
    </>
  );
}

function NotEnoughData({ count }: { count: number }) {
  return (
    <p className="alert alert--soft">
      Not enough data yet &mdash; {count}{" "}
      {count === 1 ? "answer" : "answers"} recorded. A trend needs at least{" "}
      {MIN_POINTS_FOR_TREND}.
    </p>
  );
}

/** Shared axis and tooltip setup, so the three charts cannot drift apart. */
function baseOptions(theme: Theme, series: ScorePoint[], min: number, max: number) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: {
        display: true,
        labels: { color: theme.text, boxWidth: 12, usePointStyle: true },
      },
      tooltip: {
        callbacks: {
          title: (items: Array<{ dataIndex: number }>) => {
            const point = series[items[0]?.dataIndex ?? 0];
            if (!point) return "";
            return `Answer ${(items[0]?.dataIndex ?? 0) + 1} · Part ${point.part} · ${DATE_TIME_FORMAT.format(new Date(point.createdAt))}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: theme.muted, maxTicksLimit: 8, autoSkip: true },
        grid: { display: false },
      },
      y: {
        min,
        max,
        ticks: { color: theme.muted, stepSize: 0.5 },
        grid: { color: theme.grid },
        title: { display: true, text: "Estimated band", color: theme.muted },
      },
    },
  };
}

function ScoreChart({
  labels,
  series,
  theme,
  prefersDark,
  boundaries,
}: {
  labels: string[];
  series: ScorePoint[];
  theme: Theme;
  prefersDark: boolean;
  boundaries: Array<{ index: number; version: string }>;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;

    const keys = ["overall", "fluency", "lexical", "grammar"] as const;
    const datasets: Array<ChartDataset<"line">> = keys.map((name) => {
      const colour = prefersDark ? SERIES[name].dark : SERIES[name].light;
      return {
        label: SERIES[name].label,
        data: series.map((point) =>
          name === "overall"
            ? point.overallMa
            : name === "fluency"
              ? point.fluencyMa
              : name === "lexical"
                ? point.lexicalMa
                : point.grammarMa,
        ),
        borderColor: colour,
        backgroundColor: colour,
        borderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        // A 2px surface ring keeps overlapping points readable where two
        // series cross, which they do constantly on a 1-9 scale.
        pointBorderColor: theme.surface,
        pointBorderWidth: 2,
        tension: 0.25,
        spanGaps: true,
      };
    });

    const all = datasets
      .flatMap((dataset) => dataset.data as Array<number | null>)
      .filter((value): value is number => value !== null);
    const { min, max } = bandWindow(all);

    const chart = new Chart(element, {
      type: "line",
      data: { labels, datasets },
      options: baseOptions(theme, series, min, max),
      plugins: [promptMarkerPlugin(boundaries, theme)],
    });

    return () => chart.destroy();
  }, [labels, series, theme, prefersDark, boundaries]);

  return (
    <div className="chart">
      <canvas ref={canvas} role="img" aria-label="Estimated bands over time. The same figures are in the table below." />
    </div>
  );
}

function PronunciationChart({
  labels,
  series,
  theme,
  prefersDark,
}: {
  labels: string[];
  series: ScorePoint[];
  theme: Theme;
  prefersDark: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;

    const colour = prefersDark
      ? SERIES.pronunciation.dark
      : SERIES.pronunciation.light;
    const data = series.map((point) => point.pronunciationMa);
    const present = data.filter((value): value is number => value !== null);
    const { min, max } = bandWindow(present);

    const options = baseOptions(theme, series, min, max);
    const chart = new Chart(element, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: SERIES.pronunciation.label,
            data,
            borderColor: colour,
            backgroundColor: colour,
            borderWidth: 2,
            // Dashed, so it reads as a different kind of number even in a
            // screenshot or in greyscale.
            borderDash: [6, 4],
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBorderColor: theme.surface,
            pointBorderWidth: 2,
            tension: 0.25,
            spanGaps: true,
          },
        ],
      },
      // A single series needs no legend box; the heading names it.
      options: {
        ...options,
        plugins: { ...options.plugins, legend: { display: false } },
      },
    });

    return () => chart.destroy();
  }, [labels, series, theme, prefersDark]);

  return (
    <div className="chart chart--short">
      <canvas ref={canvas} role="img" aria-label="Pronunciation indicator over time. The same figures are in the table below." />
    </div>
  );
}

function ActivityChart({
  activity,
  theme,
  prefersDark,
}: {
  activity: ActivityDay[];
  theme: Theme;
  prefersDark: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;

    const colour = prefersDark ? SERIES.overall.dark : SERIES.overall.light;
    const chart = new Chart(element, {
      type: "bar",
      data: {
        labels: activity.map((day) =>
          DAY_SHORT_FORMAT.format(new Date(`${day.day}T00:00:00Z`)),
        ),
        datasets: [
          {
            label: "Answers",
            data: activity.map((day) => day.answers),
            backgroundColor: colour,
            // 4px rounded data-ends, anchored to the baseline.
            borderRadius: 4,
            borderSkipped: "bottom",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { color: theme.muted, maxTicksLimit: 10 },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { color: theme.muted, precision: 0 },
            grid: { color: theme.grid },
          },
        },
      },
    });

    return () => chart.destroy();
  }, [activity, theme, prefersDark]);

  return (
    <div className="chart chart--short">
      <canvas ref={canvas} role="img" aria-label="Answers recorded per day." />
    </div>
  );
}

/**
 * The table view. Required, not optional: a canvas is invisible to a screen
 * reader, and three of the light-mode series colours fall below 3:1 contrast,
 * which obliges a non-colour route to the same numbers.
 */
function ScoreTable({
  series,
  promptVersions,
}: {
  series: ScorePoint[];
  promptVersions: PromptWindow[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="card">
      <h2>Every answer</h2>
      <button
        type="button"
        className="button button--quiet"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? "Hide the table" : `Show all ${series.length} answers as a table`}
      </button>

      {open ? (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <caption>
                Individual estimates per answer, newest last. All figures are AI
                estimates, not official IELTS bands.
              </caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Date</th>
                  <th scope="col">Part</th>
                  <th scope="col">Overall</th>
                  <th scope="col">Fluency</th>
                  <th scope="col">Lexical</th>
                  <th scope="col">Grammar</th>
                  <th scope="col">Pron.</th>
                  <th scope="col">Prompt</th>
                </tr>
              </thead>
              <tbody>
                {series.map((point, index) => (
                  <tr key={point.answerId}>
                    <td>{index + 1}</td>
                    <td>{DAY_SHORT_FORMAT.format(new Date(point.createdAt))}</td>
                    <td>{point.part}</td>
                    <td>{point.overall?.toFixed(1) ?? "n/a"}</td>
                    <td>{point.fluency?.toFixed(1) ?? "n/a"}</td>
                    <td>{point.lexical?.toFixed(1) ?? "n/a"}</td>
                    <td>{point.grammar?.toFixed(1) ?? "n/a"}</td>
                    <td>{point.pronunciation?.toFixed(1) ?? "n/a"}</td>
                    <td>{point.promptVersion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {promptVersions.length > 1 ? (
            <p className="muted">
              Prompt versions used:{" "}
              {promptVersions
                .map((window) => `${window.promptVersion} (${window.answers})`)
                .join(", ")}
              . Scores from different versions may not be comparable.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
