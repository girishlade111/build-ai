"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookmarkPlus, Search, X } from "lucide-react";
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
import { dashboardStrings } from "../i18n/dashboard";
import { getProjectStore } from "../storage/client";
import {
  computeProjectMetrics,
  formatBytes,
  type FileTypeKey,
  type MetricUnit,
  type ProgressPoint,
} from "../workspace/metrics";
import styles from "./ProjectDashboard.module.css";
import { ActionButton, MagicCard, NumberTicker, SegmentedControl, ShimmerButton } from "./ui";

export interface ProjectDashboardProps {
  locale: Locale;
  project: Project;
  files: ProjectFile[];
  refreshKey: number;
  historyKey: number;
  onOpenFile: (path: string) => void;
  onCheckpointCreated: () => void;
}

function metricNumber(item: { bytes: number; lines: number; files: number }, unit: MetricUnit) {
  if (unit === "bytes") return item.bytes;
  if (unit === "lines") return item.lines;
  return item.files;
}

function formatMetricValue(value: number, unit: MetricUnit): string {
  if (unit === "bytes") return formatBytes(value);
  return value.toLocaleString();
}

export function ProjectDashboard({
  locale,
  project,
  files,
  refreshKey,
  historyKey,
  onOpenFile,
  onCheckpointCreated,
}: ProjectDashboardProps) {
  const s = dashboardStrings[locale];
  const [contents, setContents] = useState<Record<string, string>>({});
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [unit, setUnit] = useState<MetricUnit>("bytes");
  const [selectedType, setSelectedType] = useState<FileTypeKey | null>(null);
  const [query, setQuery] = useState("");
  const [savingCheckpoint, setSavingCheckpoint] = useState(false);

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
      computeProjectMetrics(project, files, contents, checkpoints, {
        rootFolder: s.rootFolder,
        currentLabel: s.currentLabel,
        checkpointPrefix: s.checkpointPrefix,
      }),
    [project, files, contents, checkpoints, s.rootFolder, s.currentLabel, s.checkpointPrefix],
  );

  const typeChartData = useMemo(() => {
    const total = metrics.byType.reduce((acc, item) => acc + metricNumber(item, unit), 0);
    return metrics.byType.map((item) => {
      const value = metricNumber(item, unit);
      return {
        ...item,
        value,
        activePct: total > 0 ? Math.round((value / total) * 1000) / 10 : 0,
      };
    });
  }, [metrics.byType, unit]);

  const folderChartData = useMemo(
    () =>
      metrics.byFolder.map((item) => ({
        ...item,
        value: metricNumber(item, unit),
      })),
    [metrics.byFolder, unit],
  );

  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return metrics.files.filter((file) => {
      if (selectedType && file.type !== selectedType) return false;
      if (q && !file.path.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [metrics.files, selectedType, query]);

  const maxFileValue = useMemo(() => {
    const key = unit === "lines" ? "lines" : "bytes";
    return Math.max(1, ...metrics.files.map((f) => f[key]));
  }, [metrics.files, unit]);

  async function handleSaveCheckpoint() {
    if (savingCheckpoint) return;
    setSavingCheckpoint(true);
    try {
      const store = await getProjectStore();
      await store.createCheckpoint(project.id, s.checkpointSavedLabel, "manual");
      onCheckpointCreated();
      await loadData();
    } finally {
      setSavingCheckpoint(false);
    }
  }

  const profileLabel =
    project.profile === "static"
      ? s.profileStatic
      : project.profile === "react-vite"
        ? s.profileReact
        : s.profileOther;

  const updatedLabel = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(project.updatedAt));
    } catch {
      return project.updatedAt;
    }
  }, [locale, project.updatedAt]);

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

  const donutTotal =
    unit === "bytes"
      ? formatBytes(metrics.summary.totalBytes)
      : unit === "lines"
        ? metrics.summary.totalLines.toLocaleString()
        : metrics.summary.totalFiles.toLocaleString();

  const donutUnitLabel =
    unit === "bytes" ? s.unitBytes : unit === "lines" ? s.unitLines : s.unitFiles;

  return (
    <section className={styles.root} aria-label={s.title} data-testid="workspace-dashboard">
      <div className={styles.inner}>
        <div className={styles.topBar}>
          <div className={styles.headingBlock}>
            <h2 className={styles.title}>{s.title}</h2>
            <p className={styles.metaRow}>
              <span>{profileLabel}</span>
              <span className={styles.metaSep} aria-hidden="true">
                ·
              </span>
              <span>{updatedLabel}</span>
              <span className={styles.metaSep} aria-hidden="true">
                ·
              </span>
              <span>{s.subtitle}</span>
            </p>
          </div>
          <div className={styles.controls}>
            <SegmentedControl
              ariaLabel={s.metricUnitLabel}
              value={unit}
              onChange={setUnit}
              items={[
                { value: "bytes", label: s.unitBytes },
                { value: "lines", label: s.unitLines },
                { value: "files", label: s.unitFiles },
              ]}
            />
            <ShimmerButton
              compact
              disabled={savingCheckpoint}
              onClick={() => void handleSaveCheckpoint()}
            >
              <BookmarkPlus size={14} aria-hidden="true" />
              <span>{savingCheckpoint ? s.savingCheckpoint : s.saveCheckpoint}</span>
            </ShimmerButton>
          </div>
        </div>

        <MagicCard className={styles.kpiCard}>
          <div className={styles.kpiStrip} data-testid="dashboard-kpis">
            <div className={styles.kpiCell}>
              <p className={styles.kpiLabel}>{s.kpiFiles}</p>
              <p className={styles.kpiValue}>
                <NumberTicker value={metrics.summary.totalFiles} />
              </p>
              <p className={styles.kpiSub}>
                {metrics.summary.folderCount} {s.foldersUnit}
              </p>
            </div>
            <div className={styles.kpiCell}>
              <p className={styles.kpiLabel}>{s.kpiLines}</p>
              <p className={styles.kpiValue}>
                <NumberTicker value={metrics.summary.totalLines} />
              </p>
              <p className={styles.kpiSub}>{formatBytes(metrics.summary.totalBytes)}</p>
            </div>
            <div className={styles.kpiCell}>
              <p className={styles.kpiLabel}>{s.kpiRevisions}</p>
              <p className={styles.kpiValue}>
                <NumberTicker value={metrics.summary.headRevision} prefix="r" />
              </p>
              <p className={styles.kpiSub}>
                {metrics.summary.totalEdits} {s.editsUnit}
              </p>
            </div>
            <div className={styles.kpiCell}>
              <p className={styles.kpiLabel}>{s.kpiCheckpoints}</p>
              <p className={styles.kpiValue}>
                <NumberTicker value={metrics.summary.checkpointCount} />
              </p>
              <p className={styles.kpiSub}>
                {metrics.summary.checkpointCount === 0
                  ? `${metrics.summary.dirtySinceCheckpoint} ${s.unsavedSnapshot}`
                  : metrics.summary.dirtySinceCheckpoint === 0
                    ? s.allSynced
                    : `${metrics.summary.dirtySinceCheckpoint} ${s.unsavedSnapshot}`}
              </p>
            </div>
          </div>
        </MagicCard>

        <div className={styles.chartGrid}>
          <MagicCard as="article" className={styles.panel}>
            <div className={styles.panelInner}>
              <div className={styles.panelHead}>
                <div>
                  <h3 className={styles.panelTitle}>{s.typeChartTitle}</h3>
                  <p className={styles.panelHint}>{s.typeChartHint}</p>
                </div>
              </div>
              {typeChartData.length === 0 ? (
                <p className={styles.emptyBody}>{s.emptyProject}</p>
              ) : (
                <div className={styles.donutLayout}>
                  <div className={styles.donutWrap}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={typeChartData}
                          dataKey="value"
                          nameKey="type"
                          cx="50%"
                          cy="50%"
                          innerRadius={58}
                          outerRadius={88}
                          paddingAngle={2}
                          stroke="#111115"
                          strokeWidth={2}
                          isAnimationActive={false}
                          onClick={(_entry, index) => {
                            const clicked = typeChartData[index]?.type;
                            if (clicked) {
                              setSelectedType((prev) => (prev === clicked ? null : clicked));
                            }
                          }}
                        >
                          {typeChartData.map((entry) => (
                            <Cell
                              key={entry.type}
                              fill={entry.color}
                              fillOpacity={
                                selectedType && selectedType !== entry.type ? 0.28 : 1
                              }
                              style={{ cursor: "pointer" }}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          content={({ active, payload }) => {
                            const raw = payload?.[0]?.payload;
                            if (!active || !raw) return null;
                            const row = raw as {
                              type: string;
                              files: number;
                              bytes: number;
                              lines: number;
                              activePct: number;
                            };
                            return (
                              <div className={styles.tooltip}>
                                <p className={styles.tooltipTitle}>{row.type}</p>
                                <p className={styles.tooltipRow}>
                                  <span>{s.unitFiles}</span>
                                  <span className={styles.tooltipNum}>{row.files}</span>
                                </p>
                                <p className={styles.tooltipRow}>
                                  <span>{s.unitLines}</span>
                                  <span className={styles.tooltipNum}>{row.lines}</span>
                                </p>
                                <p className={styles.tooltipRow}>
                                  <span>{s.unitBytes}</span>
                                  <span className={styles.tooltipNum}>
                                    {formatBytes(row.bytes)} ({row.activePct}%)
                                  </span>
                                </p>
                              </div>
                            );
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className={styles.donutCenter}>
                      <span className={styles.donutTotal}>{donutTotal}</span>
                      <span className={styles.donutUnit}>{donutUnitLabel}</span>
                    </div>
                  </div>
                  <ul className={styles.legendList}>
                    {typeChartData.map((item) => (
                      <li key={item.type}>
                        <button
                          type="button"
                          className={styles.legendButton}
                          aria-pressed={selectedType === item.type}
                          onClick={() =>
                            setSelectedType((prev) => (prev === item.type ? null : item.type))
                          }
                        >
                          <span
                            className={styles.swatch}
                            style={{ background: item.color }}
                            aria-hidden="true"
                          />
                          <span className={styles.legendName}>{item.type}</span>
                          <span className={styles.legendValue}>
                            {formatMetricValue(item.value, unit)}
                          </span>
                          <span className={styles.legendPct}>{item.activePct}%</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </MagicCard>

          <MagicCard as="article" className={styles.panel}>
            <div className={styles.panelInner}>
              <div className={styles.panelHead}>
                <div>
                  <h3 className={styles.panelTitle}>{s.folderChartTitle}</h3>
                  <p className={styles.panelHint}>{s.folderChartHint}</p>
                </div>
              </div>
              {folderChartData.length === 0 ? (
                <p className={styles.emptyBody}>{s.emptyProject}</p>
              ) : (
                <div className={styles.chartBox}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={folderChartData}
                      layout="vertical"
                      margin={{ top: 6, right: 20, bottom: 6, left: 8 }}
                    >
                      <CartesianGrid stroke="rgba(255, 255, 255, 0.06)" horizontal={false} />
                      <XAxis
                        type="number"
                        stroke="rgba(255, 255, 255, 0.14)"
                        tick={{ fill: "#9e9eab", fontSize: 12 }}
                        tickFormatter={(v: number) =>
                          unit === "bytes" ? formatBytes(v) : String(v)
                        }
                      />
                      <YAxis
                        type="category"
                        dataKey="folder"
                        width={86}
                        stroke="rgba(255, 255, 255, 0.14)"
                        tick={{ fill: "#d4d4dc", fontSize: 12 }}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(255, 255, 255, 0.04)" }}
                        content={({ active, payload }) => {
                          const raw = payload?.[0]?.payload;
                          if (!active || !raw) return null;
                          const row = raw as {
                            folder: string;
                            files: number;
                            bytes: number;
                            lines: number;
                          };
                          return (
                            <div className={styles.tooltip}>
                              <p className={styles.tooltipTitle}>{row.folder}</p>
                              <p className={styles.tooltipRow}>
                                <span>{s.unitFiles}</span>
                                <span className={styles.tooltipNum}>{row.files}</span>
                              </p>
                              <p className={styles.tooltipRow}>
                                <span>{s.unitLines}</span>
                                <span className={styles.tooltipNum}>{row.lines}</span>
                              </p>
                              <p className={styles.tooltipRow}>
                                <span>{s.unitBytes}</span>
                                <span className={styles.tooltipNum}>{formatBytes(row.bytes)}</span>
                              </p>
                            </div>
                          );
                        }}
                      />
                      <Bar
                        dataKey="value"
                        fill="#f54e00"
                        radius={[0, 6, 6, 0]}
                        barSize={22}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </MagicCard>
        </div>

        <MagicCard as="article" className={styles.panel}>
          <div className={styles.panelInner}>
            <div className={styles.panelHead}>
              <div>
                <h3 className={styles.panelTitle}>{s.progressChartTitle}</h3>
                <p className={styles.panelHint}>{s.progressChartHint}</p>
              </div>
              {metrics.summary.checkpointCount > 0 ? (
                <div className={styles.seriesLegend}>
                  <span className={styles.seriesLegendItem}>
                    <span
                      className={styles.swatch}
                      style={{ background: "#60a5fa" }}
                      aria-hidden="true"
                    />
                    {s.seriesFiles}
                  </span>
                  <span className={styles.seriesLegendItem}>
                    <span
                      className={styles.swatch}
                      style={{ background: "#f54e00" }}
                      aria-hidden="true"
                    />
                    {s.seriesChanged}
                  </span>
                </div>
              ) : null}
            </div>
            {metrics.summary.checkpointCount === 0 ? (
              <div className={styles.emptyBlock}>
                <p className={styles.emptyTitle}>{s.progressEmptyTitle}</p>
                <p className={styles.emptyBody}>{s.progressEmptyBody}</p>
                <ShimmerButton
                  compact
                  disabled={savingCheckpoint}
                  onClick={() => void handleSaveCheckpoint()}
                >
                  <BookmarkPlus size={14} aria-hidden="true" />
                  <span>{savingCheckpoint ? s.savingCheckpoint : s.progressFirstCta}</span>
                </ShimmerButton>
              </div>
            ) : (
              <div className={styles.progressChartBox}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={metrics.progressTimeline}
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
                        const pt = raw as ProgressPoint;
                        return (
                          <div className={styles.tooltip}>
                            <p className={styles.tooltipTitle}>{pt.label}</p>
                            <p className={styles.tooltipRow}>
                              <span>{s.seriesFiles}</span>
                              <span className={styles.tooltipNum}>{pt.fileCount}</span>
                            </p>
                            <p className={styles.tooltipRow}>
                              <span>{s.seriesChanged}</span>
                              <span className={styles.tooltipNum}>{pt.changedFiles}</span>
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="fileCount"
                      name={s.seriesFiles}
                      stroke="#60a5fa"
                      fill="#60a5fa"
                      fillOpacity={0.16}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="changedFiles"
                      name={s.seriesChanged}
                      fill="#f54e00"
                      radius={[4, 4, 0, 0]}
                      barSize={24}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </MagicCard>

        <MagicCard as="article" className={styles.panel}>
          <div className={styles.panelInner}>
            <div className={styles.tableHeader}>
              <h3 className={styles.panelTitle}>{s.tableTitle}</h3>
              <div className={styles.tableTools}>
                <div className={styles.searchWrap}>
                  <Search size={14} className={styles.searchIcon} aria-hidden="true" />
                  <input
                    type="search"
                    className={styles.searchInput}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={s.searchPlaceholder}
                    aria-label={s.searchPlaceholder}
                  />
                </div>
                {selectedType || query ? (
                  <ActionButton
                    variant="outline"
                    compact
                    onClick={() => {
                      setSelectedType(null);
                      setQuery("");
                    }}
                  >
                    <X size={13} aria-hidden="true" />
                    <span>{s.clearFilter}</span>
                  </ActionButton>
                ) : null}
              </div>
            </div>

            {filteredFiles.length === 0 ? (
              <p className={styles.emptyBody}>
                {metrics.files.length === 0 ? s.emptyProject : s.noMatchingFiles}
              </p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">{s.colPath}</th>
                      <th scope="col">{s.colType}</th>
                      <th scope="col" className={styles.numCol}>
                        {s.colLines}
                      </th>
                      <th scope="col" className={styles.numCol}>
                        {s.colSize}
                      </th>
                      <th scope="col" className={styles.numCol}>
                        {s.colRevision}
                      </th>
                      <th scope="col">{s.colShare}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFiles.map((file) => {
                      const barVal = unit === "lines" ? file.lines : file.bytes;
                      const barPct = Math.max(3, Math.round((barVal / maxFileValue) * 100));
                      return (
                        <tr key={file.path}>
                          <td>
                            <button
                              type="button"
                              className={styles.fileRowButton}
                              title={s.openInEditor}
                              onClick={() => onOpenFile(file.path)}
                            >
                              {file.path}
                            </button>
                          </td>
                          <td className={styles.cellPad}>
                            <span className={styles.typeText}>
                              <span
                                className={styles.swatch}
                                style={{ background: file.color }}
                                aria-hidden="true"
                              />
                              {file.type}
                            </span>
                          </td>
                          <td className={`${styles.cellPad} ${styles.numCol}`}>
                            {file.lines.toLocaleString()}
                          </td>
                          <td className={`${styles.cellPad} ${styles.numCol}`}>
                            {formatBytes(file.bytes)}
                          </td>
                          <td className={`${styles.cellPad} ${styles.numCol}`}>
                            r{file.revision}
                          </td>
                          <td className={styles.barCell}>
                            <div className={styles.barTrack} aria-hidden="true">
                              <div
                                className={styles.barFill}
                                style={{ width: `${barPct}%`, background: file.color }}
                              />
                            </div>
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
