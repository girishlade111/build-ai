"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookmarkPlus } from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Locale } from "@ladestack/i18n";
import type { Checkpoint, Project, ProjectFile } from "@ladestack/shared-types";
import { overviewStrings } from "../i18n/overview";
import { getProjectStore } from "../storage/client";
import {
  formatSavedClock,
  formatSavedDateTime,
  type FileAuthorship,
  type FileChangeEvent,
} from "../workspace/autosave";
import {
  computeProjectOverviewMetrics,
  type ChangeTimelinePoint,
  type ComponentDependencyNode,
  type DepthDistributionBucket,
} from "../workspace/overviewMetrics";
import styles from "./ProjectOverview.module.css";
import { MagicCard, NumberTicker, SegmentedControl, ShimmerButton } from "./ui";

export interface ProjectOverviewProps {
  locale: Locale;
  project: Project;
  files: ProjectFile[];
  refreshKey: number;
  historyKey: number;
  authorship: Record<string, FileAuthorship>;
  changeHistory: FileChangeEvent[];
  lastAutoSavedAt: string | null;
  onOpenFile: (path: string) => void;
  onSnapshotSaved: () => void;
}

type ActivityFilter = "all" | "manual" | "ai";
type DepthViewMode = "modules" | "distribution";

const AI_COLOR = "#f54e00";
const MANUAL_COLOR = "#60a5fa";
const CUMULATIVE_COLOR = "#f59e0b";

export function ProjectOverview({
  locale,
  project,
  files,
  refreshKey,
  historyKey,
  authorship,
  changeHistory,
  lastAutoSavedAt,
  onOpenFile,
  onSnapshotSaved,
}: ProjectOverviewProps) {
  const s = overviewStrings[locale];
  const [contents, setContents] = useState<Record<string, string>>({});
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [depthMode, setDepthMode] = useState<DepthViewMode>("modules");
  const [savingSnapshot, setSavingSnapshot] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const store = await getProjectStore();
      const [allFiles, cpList] = await Promise.all([
        store.readAllFiles(project.id),
        store.listCheckpoints(project.id),
      ]);
      setContents(Object.fromEntries(allFiles.map((f) => [f.path, f.content])));
      setCheckpoints(cpList);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void loadData();
  }, [loadData, refreshKey, historyKey, files.length]);

  const metrics = useMemo(
    () =>
      computeProjectOverviewMetrics(
        project,
        files,
        contents,
        checkpoints,
        authorship,
        changeHistory,
        {
          createdLabel: s.createdLabel,
          currentLabel: s.currentLabel,
          checkpointPrefix: s.checkpointPrefix,
        },
      ),
    [
      project,
      files,
      contents,
      checkpoints,
      authorship,
      changeHistory,
      s.createdLabel,
      s.currentLabel,
      s.checkpointPrefix,
    ],
  );

  const moduleDepthData = useMemo(
    () =>
      metrics.dependencyNodes.slice(0, 8).map((node) => ({
        ...node,
        displayLabel: node.path.length > 22 ? `…${node.path.slice(-20)}` : node.path,
      })),
    [metrics.dependencyNodes],
  );

  const authorshipPieData = useMemo(() => {
    const items = [
      {
        key: "ai" as const,
        name: s.aiGenerated,
        value: metrics.authorship.aiLines,
        pct: metrics.authorship.aiPct,
        color: AI_COLOR,
      },
      {
        key: "manual" as const,
        name: s.manualCode,
        value: metrics.authorship.manualLines,
        pct: metrics.authorship.manualPct,
        color: MANUAL_COLOR,
      },
    ];
    const nonZero = items.filter((i) => i.value > 0);
    return nonZero.length > 0 ? nonZero : [{ ...items[1]!, value: 1, pct: 100 }];
  }, [metrics.authorship, s.aiGenerated, s.manualCode]);
  const hasMultipleSlices = authorshipPieData.length > 1;

  const authorshipByPath = useMemo(
    () => new Map(metrics.authorship.byFile.map((item) => [item.path, item])),
    [metrics.authorship.byFile],
  );

  async function handleSaveSnapshot() {
    if (savingSnapshot) return;
    setSavingSnapshot(true);
    try {
      const store = await getProjectStore();
      await store.createCheckpoint(project.id, s.snapshotSavedLabel, "manual");
      onSnapshotSaved();
      await loadData();
    } finally {
      setSavingSnapshot(false);
    }
  }

  const savedClock = lastAutoSavedAt ? formatSavedClock(lastAutoSavedAt, locale) : "";
  const savedTitle = lastAutoSavedAt ? formatSavedDateTime(lastAutoSavedAt, locale) : "";

  if (loading) {
    return (
      <section className={styles.root} aria-label={s.title}>
        <div className={styles.inner}>
          <p className={styles.statusMessage} role="status">
            {s.loading}
          </p>
          <div className={styles.skeletonGrid} aria-hidden="true">
            <div className={styles.skeletonBlock} />
            <div className={styles.skeletonBlock} />
            <div className={styles.skeletonBlock} />
            <div className={styles.skeletonBlock} />
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className={styles.root} aria-label={s.title}>
        <div className={styles.inner}>
          <p className={styles.statusMessage} role="alert">
            {s.loadError}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.root} aria-label={s.title} data-testid="workspace-overview">
      <div className={styles.inner}>
        <div className={styles.topBar}>
          <div className={styles.headingBlock}>
            <h2 className={styles.title}>{s.title}</h2>
            <p className={styles.metaRow}>
              <span>{s.subtitle}</span>
              <span className={styles.metaSep} aria-hidden="true">
                ·
              </span>
              <span>
                {metrics.summary.totalFiles} {s.filesUnit}
              </span>
              <span className={styles.metaSep} aria-hidden="true">
                ·
              </span>
              <span>
                {metrics.summary.totalLines.toLocaleString()} {s.linesUnit}
              </span>
            </p>
          </div>

          <div className={styles.controls}>
            <SegmentedControl
              ariaLabel={s.filterLabel}
              value={activityFilter}
              onChange={setActivityFilter}
              items={[
                { value: "all", label: s.filterAll },
                { value: "manual", label: s.filterManual },
                { value: "ai", label: s.filterAi },
              ]}
            />
            <ShimmerButton
              compact
              disabled={savingSnapshot}
              onClick={() => void handleSaveSnapshot()}
            >
              <BookmarkPlus size={14} aria-hidden="true" />
              <span>{savingSnapshot ? s.savingSnapshot : s.saveSnapshot}</span>
            </ShimmerButton>
          </div>
        </div>

        <MagicCard className={styles.kpiCard}>
          <div className={styles.kpiStrip} data-testid="overview-kpis">
            <div className={styles.kpiCell}>
              <p className={styles.kpiLabel}>{s.kpiChanges}</p>
              <p className={styles.kpiValue}>
                <NumberTicker value={metrics.summary.filesModifiedTotal} />
              </p>
              <p className={styles.kpiSub}>
                {metrics.summary.totalChangeEvents} {s.kpiChangesSub}
              </p>
            </div>
            <div className={styles.kpiCell}>
              <p className={styles.kpiLabel}>{s.kpiDepth}</p>
              <p className={styles.kpiValue}>
                <NumberTicker
                  value={metrics.summary.maxDependencyDepth}
                  suffix={` ${s.kpiDepthLevels}`}
                />
              </p>
              <p className={styles.kpiSub}>
                {metrics.summary.localEdges} {s.kpiDepthLinks} · {metrics.summary.externalPackages}{" "}
                npm
              </p>
            </div>
            <div className={styles.kpiCell}>
              <p className={styles.kpiLabel}>{s.kpiAuthorship}</p>
              <p className={styles.kpiValue}>
                <NumberTicker value={metrics.summary.aiPct} suffix="%" /> /{" "}
                <NumberTicker value={metrics.summary.manualPct} suffix="%" />
              </p>
              <p className={styles.kpiSub}>
                {metrics.summary.aiLines.toLocaleString()} /{" "}
                {metrics.summary.manualLines.toLocaleString()} {s.linesUnit}
              </p>
            </div>
            <div className={styles.kpiCell} title={savedTitle || undefined}>
              <p className={styles.kpiLabel}>{s.kpiAutoSave}</p>
              <p className={styles.kpiValue} data-testid="overview-autosave-time">
                {savedClock || s.kpiAutoSaveWaiting}
              </p>
              <p className={styles.kpiSub}>{s.kpiAutoSaveSub}</p>
            </div>
          </div>
        </MagicCard>

        <MagicCard as="article" className={styles.panel} data-testid="chart-files-changed">
          <div className={styles.panelInner}>
            <div className={styles.panelHead}>
              <div>
                <h3 className={styles.panelTitle}>{s.timelineTitle}</h3>
                <p className={styles.panelHint}>{s.timelineHint}</p>
              </div>
              <div className={styles.seriesLegend}>
                {activityFilter !== "ai" ? (
                  <span className={styles.seriesLegendItem}>
                    <span
                      className={styles.swatch}
                      style={{ background: MANUAL_COLOR }}
                      aria-hidden="true"
                    />
                    {s.seriesManual}
                  </span>
                ) : null}
                {activityFilter !== "manual" ? (
                  <span className={styles.seriesLegendItem}>
                    <span
                      className={styles.swatch}
                      style={{ background: AI_COLOR }}
                      aria-hidden="true"
                    />
                    {s.seriesAi}
                  </span>
                ) : null}
                <span className={styles.seriesLegendItem}>
                  <span
                    className={styles.swatch}
                    style={{ background: CUMULATIVE_COLOR }}
                    aria-hidden="true"
                  />
                  {s.seriesCumulative}
                </span>
              </div>
            </div>
            <div className={styles.timelineChartBox}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={metrics.filesChangedTimeline}
                  margin={{ top: 10, right: 16, bottom: 4, left: 0 }}
                >
                  <CartesianGrid stroke="rgba(255, 255, 255, 0.06)" vertical={false} />
                  <XAxis
                    dataKey="shortLabel"
                    stroke="rgba(255, 255, 255, 0.14)"
                    tick={{ fill: "#9e9eab", fontSize: 12 }}
                  />
                  <YAxis
                    allowDecimals={false}
                    stroke="rgba(255, 255, 255, 0.14)"
                    tick={{ fill: "#9e9eab", fontSize: 12 }}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255, 255, 255, 0.04)" }}
                    content={({ active, payload }) => {
                      const raw = payload?.[0]?.payload;
                      if (!active || !raw) return null;
                      const pt = raw as ChangeTimelinePoint;
                      return (
                        <div className={styles.tooltip}>
                          <p className={styles.tooltipTitle}>{pt.label}</p>
                          <p className={styles.tooltipRow}>
                            <span>{s.seriesTotalChanged}</span>
                            <span className={styles.tooltipNum}>{pt.filesChanged}</span>
                          </p>
                          <p className={styles.tooltipRow}>
                            <span>{s.seriesManual}</span>
                            <span className={styles.tooltipNum}>{pt.manualChanged}</span>
                          </p>
                          <p className={styles.tooltipRow}>
                            <span>{s.seriesAi}</span>
                            <span className={styles.tooltipNum}>{pt.aiChanged}</span>
                          </p>
                          <p className={styles.tooltipRow}>
                            <span>{s.seriesCumulative}</span>
                            <span className={styles.tooltipNum}>{pt.cumulativeChanges}</span>
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="cumulativeChanges"
                    name={s.seriesCumulative}
                    stroke={CUMULATIVE_COLOR}
                    fill={CUMULATIVE_COLOR}
                    fillOpacity={0.14}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                  {activityFilter !== "ai" ? (
                    <Bar
                      dataKey="manualChanged"
                      name={s.seriesManual}
                      stackId="changes"
                      fill={MANUAL_COLOR}
                      radius={[3, 3, 0, 0]}
                      barSize={22}
                      isAnimationActive={false}
                    />
                  ) : null}
                  {activityFilter !== "manual" ? (
                    <Bar
                      dataKey="aiChanged"
                      name={s.seriesAi}
                      stackId="changes"
                      fill={AI_COLOR}
                      radius={[3, 3, 0, 0]}
                      barSize={22}
                      isAnimationActive={false}
                    />
                  ) : null}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </MagicCard>

        <div className={styles.twoColGrid}>
          <MagicCard as="article" className={styles.panel} data-testid="chart-dependency-depth">
            <div className={styles.panelInner}>
              <div className={styles.panelHead}>
                <div className={styles.panelHeadText}>
                  <h3 className={styles.panelTitle}>{s.depthTitle}</h3>
                  <p className={styles.panelHint}>{s.depthHint}</p>
                </div>
                <SegmentedControl
                  ariaLabel={s.depthTitle}
                  value={depthMode}
                  onChange={setDepthMode}
                  items={[
                    { value: "modules", label: s.depthModeModules },
                    { value: "distribution", label: s.depthModeDistribution },
                  ]}
                />
              </div>

              {metrics.dependencyNodes.length === 0 ? (
                <p className={styles.emptyBody}>{s.emptyProject}</p>
              ) : depthMode === "modules" ? (
                <div className={styles.chartBox}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={moduleDepthData}
                      layout="vertical"
                      margin={{ top: 4, right: 20, bottom: 4, left: 4 }}
                    >
                      <CartesianGrid stroke="rgba(255, 255, 255, 0.06)" horizontal={false} />
                      <XAxis
                        type="number"
                        domain={[0, (dataMax: number) => Math.max(2, dataMax)]}
                        allowDecimals={false}
                        stroke="rgba(255, 255, 255, 0.14)"
                        tick={{ fill: "#9e9eab", fontSize: 12 }}
                      />
                      <YAxis
                        type="category"
                        dataKey="displayLabel"
                        width={126}
                        stroke="rgba(255, 255, 255, 0.14)"
                        tick={{ fill: "#d4d4dc", fontSize: 11 }}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(255, 255, 255, 0.04)" }}
                        content={({ active, payload }) => {
                          const raw = payload?.[0]?.payload;
                          if (!active || !raw) return null;
                          const node = raw as ComponentDependencyNode;
                          return (
                            <div className={styles.tooltip}>
                              <p className={styles.tooltipTitle}>{node.path}</p>
                              <p className={styles.tooltipRow}>
                                <span>{s.depthLevelLabel}</span>
                                <span className={styles.tooltipNum}>L{node.depth}</span>
                              </p>
                              <p className={styles.tooltipRow}>
                                <span>{s.depthDirectDeps}</span>
                                <span className={styles.tooltipNum}>
                                  {node.directLocalDeps.length}
                                </span>
                              </p>
                              <p className={styles.tooltipRow}>
                                <span>{s.depthExternalDeps}</span>
                                <span className={styles.tooltipNum}>
                                  {node.externalDeps.length}
                                </span>
                              </p>
                              <p className={styles.tooltipRow}>
                                <span>{s.depthDependents}</span>
                                <span className={styles.tooltipNum}>{node.dependentsCount}</span>
                              </p>
                              {node.hasCycle ? (
                                <p className={styles.tooltipWarn}>{s.depthCycleFlag}</p>
                              ) : null}
                            </div>
                          );
                        }}
                      />
                      <Bar
                        dataKey="depth"
                        name={s.depthLevelLabel}
                        radius={[0, 6, 6, 0]}
                        barSize={18}
                        isAnimationActive={false}
                        onClick={(_entry, index) => {
                          const node = moduleDepthData[index];
                          if (node) onOpenFile(node.path);
                        }}
                      >
                        {moduleDepthData.map((entry) => (
                          <Cell
                            key={entry.path}
                            fill={
                              entry.hasCycle
                                ? "#f59e0b"
                                : entry.depth >= 2
                                  ? AI_COLOR
                                  : entry.depth === 1
                                    ? "#fb923c"
                                    : "#525260"
                            }
                            style={{ cursor: "pointer" }}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className={styles.chartBox}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={metrics.depthDistribution}
                      margin={{ top: 10, right: 16, bottom: 4, left: 0 }}
                    >
                      <CartesianGrid stroke="rgba(255, 255, 255, 0.06)" vertical={false} />
                      <XAxis
                        dataKey="label"
                        stroke="rgba(255, 255, 255, 0.14)"
                        tick={{ fill: "#9e9eab", fontSize: 12 }}
                      />
                      <YAxis
                        allowDecimals={false}
                        stroke="rgba(255, 255, 255, 0.14)"
                        tick={{ fill: "#9e9eab", fontSize: 12 }}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(255, 255, 255, 0.04)" }}
                        content={({ active, payload }) => {
                          const raw = payload?.[0]?.payload;
                          if (!active || !raw) return null;
                          const bucket = raw as DepthDistributionBucket;
                          return (
                            <div className={styles.tooltip}>
                              <p className={styles.tooltipTitle}>
                                {s.depthLevelLabel} {bucket.depth}
                              </p>
                              <p className={styles.tooltipRow}>
                                <span>{s.depthModulesCount}</span>
                                <span className={styles.tooltipNum}>{bucket.count}</span>
                              </p>
                            </div>
                          );
                        }}
                      />
                      <Bar
                        dataKey="count"
                        name={s.depthModulesCount}
                        fill={AI_COLOR}
                        radius={[4, 4, 0, 0]}
                        barSize={32}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </MagicCard>

          <MagicCard as="article" className={styles.panel} data-testid="chart-ai-vs-manual">
            <div className={styles.panelInner}>
              <div className={styles.panelHead}>
                <div>
                  <h3 className={styles.panelTitle}>{s.authorshipTitle}</h3>
                  <p className={styles.panelHint}>{s.authorshipHint}</p>
                </div>
              </div>

              {metrics.summary.totalFiles === 0 ? (
                <p className={styles.emptyBody}>{s.emptyProject}</p>
              ) : (
                <div className={styles.authorshipLayout}>
                  <div className={styles.donutWrap}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={authorshipPieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={58}
                          outerRadius={88}
                          paddingAngle={hasMultipleSlices ? 2 : 0}
                          stroke={hasMultipleSlices ? "#111115" : "none"}
                          strokeWidth={hasMultipleSlices ? 2 : 0}
                          isAnimationActive={false}
                        >
                          {authorshipPieData.map((entry) => (
                            <Cell key={entry.key} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          content={({ active, payload }) => {
                            const raw = payload?.[0]?.payload;
                            if (!active || !raw) return null;
                            const slice = raw as { name: string; value: number; pct: number };
                            return (
                              <div className={styles.tooltip}>
                                <p className={styles.tooltipTitle}>{slice.name}</p>
                                <p className={styles.tooltipRow}>
                                  <span>{s.colLines}</span>
                                  <span className={styles.tooltipNum}>
                                    {slice.value.toLocaleString()} ({slice.pct}%)
                                  </span>
                                </p>
                              </div>
                            );
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className={styles.donutCenter}>
                      <span className={styles.donutTotal}>
                        <NumberTicker value={metrics.authorship.aiPct} suffix="%" />
                      </span>
                      <span className={styles.donutUnit}>{s.aiGenerated}</span>
                    </div>
                  </div>

                  <div className={styles.authorshipStats}>
                    <div className={styles.authorshipRow}>
                      <div className={styles.authorshipRowTop}>
                        <span className={styles.authorshipName}>
                          <span
                            className={styles.swatch}
                            style={{ background: AI_COLOR }}
                            aria-hidden="true"
                          />
                          {s.aiGenerated}
                        </span>
                        <span className={styles.authorshipPct}>{metrics.authorship.aiPct}%</span>
                      </div>
                      <div className={styles.miniTrack} aria-hidden="true">
                        <div
                          className={styles.miniFill}
                          style={{ width: `${metrics.authorship.aiPct}%`, background: AI_COLOR }}
                        />
                      </div>
                      <p className={styles.authorshipSub}>
                        <span>
                          {metrics.authorship.aiLines.toLocaleString()} {s.linesUnit}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {metrics.authorship.aiFiles} {s.filesUnit}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {metrics.authorship.aiEdits} {s.editsUnit}
                        </span>
                      </p>
                    </div>

                    <div className={styles.authorshipRow}>
                      <div className={styles.authorshipRowTop}>
                        <span className={styles.authorshipName}>
                          <span
                            className={styles.swatch}
                            style={{ background: MANUAL_COLOR }}
                            aria-hidden="true"
                          />
                          {s.manualCode}
                        </span>
                        <span className={styles.authorshipPct}>
                          {metrics.authorship.manualPct}%
                        </span>
                      </div>
                      <div className={styles.miniTrack} aria-hidden="true">
                        <div
                          className={styles.miniFill}
                          style={{
                            width: `${metrics.authorship.manualPct}%`,
                            background: MANUAL_COLOR,
                          }}
                        />
                      </div>
                      <p className={styles.authorshipSub}>
                        <span>
                          {metrics.authorship.manualLines.toLocaleString()} {s.linesUnit}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {metrics.authorship.manualFiles} {s.filesUnit}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {metrics.authorship.manualEdits} {s.editsUnit}
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </MagicCard>
        </div>

        <MagicCard as="article" className={styles.panel}>
          <div className={styles.panelInner}>
            <div className={styles.panelHead}>
              <div>
                <h3 className={styles.panelTitle}>{s.breakdownTitle}</h3>
                <p className={styles.panelHint}>{s.breakdownHint}</p>
              </div>
            </div>

            {metrics.dependencyNodes.length === 0 ? (
              <p className={styles.emptyBody}>{s.emptyProject}</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{s.colFile}</th>
                      <th scope="col" className={styles.numCol}>
                        {s.colDepth}
                      </th>
                      <th scope="col" className={styles.numCol}>
                        {s.colLocalImports}
                      </th>
                      <th scope="col">{s.colOrigin}</th>
                      <th scope="col" className={styles.numCol}>
                        {s.colLines}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.dependencyNodes.map((node) => {
                      const origin = authorshipByPath.get(node.path);
                      const aiPct = origin?.aiPct ?? 0;
                      const originLabel =
                        origin?.dominant === "ai"
                          ? s.aiGenerated
                          : origin?.dominant === "mixed"
                            ? `${s.mixedCode} (${aiPct}%)`
                            : s.manualCode;
                      return (
                        <tr key={node.path}>
                          <td>
                            <button
                              type="button"
                              className={styles.fileRowButton}
                              title={s.openInEditor}
                              onClick={() => onOpenFile(node.path)}
                            >
                              {node.path}
                              {node.hasCycle ? (
                                <span className={styles.cycleText}>({s.depthCycleFlag})</span>
                              ) : null}
                            </button>
                          </td>
                          <td className={`${styles.cellPad} ${styles.numCol}`}>L{node.depth}</td>
                          <td className={`${styles.cellPad} ${styles.numCol}`}>
                            {node.directLocalDeps.length}
                            {node.externalDeps.length > 0 ? ` + ${node.externalDeps.length}` : ""}
                          </td>
                          <td className={styles.cellPad}>
                            <span className={styles.originCell}>
                              <span className={styles.originBar} aria-hidden="true">
                                <span style={{ width: `${aiPct}%`, background: AI_COLOR }} />
                                <span
                                  style={{ width: `${100 - aiPct}%`, background: MANUAL_COLOR }}
                                />
                              </span>
                              {originLabel}
                            </span>
                          </td>
                          <td className={`${styles.cellPad} ${styles.numCol}`}>
                            {node.lines.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </MagicCard>
      </div>
    </section>
  );
}
