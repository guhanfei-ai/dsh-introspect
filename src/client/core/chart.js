// Generated source fragment. Edit this file, then run npm run build:client.
				//#region MEL × RRI 纯 SVG 图表 — observability-grade time series
				const CHART_PAD = { top: 12, right: 12, bottom: 26, left: 32 };
				const CHART_DEFAULTS = { width: 300, height: 160 };
				const MEL_COLOR = "var(--dsw-alias-state-business-primary, #818cf8)";
				const RRI_COLOR = "var(--dsw-alias-state-success-primary, #34d399)";
				const GAP_FILL = "var(--dsw-alias-state-business-primary, #818cf8)";
				const TICK_COLOR = "var(--dsw-alias-label-caption, #6b7280)";
				const GRID_COLOR = "var(--dsw-alias-border-l2, rgba(255,255,255,0.06))";
				const CROSSHAIR_COLOR = "var(--dsw-alias-label-caption, #6b7280)";
				const MEL_MAX = 200;
				const RRI_MAX = 100;

				function plotArea(width, height) {
					const left = CHART_PAD.left;
					const top = CHART_PAD.top;
					const w = Math.max(1, width - CHART_PAD.left - CHART_PAD.right);
					const h = Math.max(1, height - CHART_PAD.top - CHART_PAD.bottom);
					return { left, top, w, h };
				}

				function scaleY(value100, area) {
					if (value100 == null || !Number.isFinite(value100)) return null;
					return area.top + area.h - Math.max(0, Math.min(100, value100)) * area.h / 100;
				}

				/** 时间 → x 坐标：按真实 timestamp 在 window 中的比例定位。 */
				function scaleTimeX(timeMs, startMs, endMs, area) {
					if (!Number.isFinite(timeMs) || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
					const span = endMs - startMs;
					if (span <= 0) return area.left + area.w * 0.5;
					const ratio = (timeMs - startMs) / span;
					return area.left + Math.max(0, Math.min(1, ratio)) * area.w;
				}

				function polylinePath(points) {
					if (points.length === 0) return "";
					let d = "";
					for (let i = 0; i < points.length; i++) {
						const p = points[i];
						if (p.y == null) continue;
						d += (d === "" ? "M" : "L") + p.x.toFixed(1) + " " + p.y.toFixed(1);
					}
					return d;
				}

				function buildGapSegment(coords, from, to) {
					const upper = [];
					const lower = [];
					for (let i = from; i < to; i++) {
						if (coords[i].melY == null || coords[i].rriY == null) continue;
						upper.push({ x: coords[i].x, y: coords[i].melY });
						lower.push({ x: coords[i].x, y: coords[i].rriY });
					}
					if (upper.length < 2) return "";
					let d = `M${upper[0].x.toFixed(1)} ${upper[0].y.toFixed(1)}`;
					for (let i = 1; i < upper.length; i++) d += `L${upper[i].x.toFixed(1)} ${upper[i].y.toFixed(1)}`;
					for (let i = lower.length - 1; i >= 0; i--) d += `L${lower[i].x.toFixed(1)} ${lower[i].y.toFixed(1)}`;
					return d + "Z";
				}

				function lastNonNull(series, key) {
					for (let i = series.length - 1; i >= 0; i--) {
						const value = series[i][key];
						if (typeof value === "number" && Number.isFinite(value)) return { index: i, value };
					}
					return null;
				}

				//#region 时间轴刻度生成 — 基于固定 window
				function timeMs(iso) {
					if (!iso) return NaN;
					const ms = new Date(String(iso)).getTime();
					return Number.isFinite(ms) ? ms : NaN;
				}

				function fmtHHmm(ms) {
					const d = new Date(ms);
					return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
				}

				function fmtMMdd(ms) {
					const d = new Date(ms);
					return String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
				}

				function snapMinute(ms, step) {
					return Math.floor(ms / (step * 60000)) * (step * 60000);
				}

				function snapHour(ms) {
					return Math.floor(ms / 3600000) * 3600000;
				}

				function snapLocalMidnight(ms) {
					const d = new Date(ms);
					d.setHours(0, 0, 0, 0);
					return d.getTime();
				}

				/** 每个 range 的建议 tick 间隔（分钟）。 */
				const TICK_INTERVALS = {
					1: 15,
					3: 30,
					6: 60,
					12: 120,
					24: 240,
					48: 480,
					72: 720,
				};

				/**
				 * 从固定时间窗口生成 X 轴刻度。
				 * 不依赖数据——即使 series 为空也必须生成完整时间轴。
				 * @param {{startMs: number, endMs: number, hours: number}} window
				 * @returns {{ms: number, label: string}[]}
				 */
				function generateWindowTicks(window) {
					const { startMs, endMs, hours } = window;
					if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
					const intervalMin = TICK_INTERVALS[hours] || 60;
					const intervalMs = intervalMin * 60000;
					const crossDay = new Date(startMs).getDate() !== new Date(endMs).getDate();
					const needDate = hours >= 24 || crossDay;
					const result = [];
					// 对齐到自然时间边界
					let t;
					if (intervalMin >= 60) {
						t = snapHour(startMs);
						if (t < startMs) t += 3600000;
						const stepHours = intervalMin / 60;
						while (t <= endMs) {
							const h = new Date(t).getHours();
							if (stepHours <= 1 || h % stepHours === 0) {
								result.push({ ms: t, label: needDate ? fmtMMdd(t) + " " + fmtHHmm(t) : fmtHHmm(t) });
							}
							t += 3600000;
						}
					} else {
						t = snapMinute(startMs, intervalMin);
						if (t < startMs) t += intervalMs;
						while (t <= endMs) {
							result.push({ ms: t, label: fmtHHmm(t) });
							t += intervalMs;
						}
					}
					// 首尾保底：确保第一个和最后一个 tick 存在
					if (result.length === 0) {
						result.push({ ms: startMs, label: needDate ? fmtMMdd(startMs) + " " + fmtHHmm(startMs) : fmtHHmm(startMs) });
						result.push({ ms: endMs, label: needDate ? fmtMMdd(endMs) + " " + fmtHHmm(endMs) : fmtHHmm(endMs) });
					} else {
						if (result[0].ms > startMs + (endMs - startMs) * 0.2) {
							result.unshift({ ms: startMs, label: needDate ? fmtMMdd(startMs) + " " + fmtHHmm(startMs) : fmtHHmm(startMs) });
						}
						if (result[result.length - 1].ms < endMs - (endMs - startMs) * 0.2) {
							result.push({ ms: endMs, label: needDate ? fmtMMdd(endMs) + " " + fmtHHmm(endMs) : fmtHHmm(endMs) });
						}
					}
					return result;
				}
				//#endregion

				/**
				 * 纯函数：从时间序列 + 固定时间窗口算出 SVG 几何。
				 * 现在 x 轴由 windowStart→windowEnd 决定，点按真实 timestamp 定位。
				 *
				 * @param {Array} series - 时间序列数据
				 * @param {number} width
				 * @param {number} height
				 * @param {{startMs: number, endMs: number, hours: number}} timeWindow - 固定时间窗口
				 */
				function buildChartPaths(series, width, height, timeWindow) {
					const w = typeof width === "number" && width > 0 ? width : CHART_DEFAULTS.width;
					const h = typeof height === "number" && height > 0 ? height : CHART_DEFAULTS.height;
					const area = plotArea(w, h);
					const startMs = timeWindow && Number.isFinite(timeWindow.startMs) ? timeWindow.startMs : 0;
					const endMs = timeWindow && Number.isFinite(timeWindow.endMs) ? timeWindow.endMs : 1;
					const hours = timeWindow && Number.isFinite(timeWindow.hours) ? timeWindow.hours : 1;
					// X 轴刻度：基于 window，不依赖数据
					const rawTicks = generateWindowTicks({ startMs, endMs, hours });
					const xTicks = rawTicks.map(function (tick) {
						return { ms: tick.ms, label: tick.label, x: scaleTimeX(tick.ms, startMs, endMs, area).toFixed(1) };
					});
					// Y 轴网格
					const yGrid = [0, 50, 100].map(function (v) {
						return { value: v, y: scaleY(v, area).toFixed(1), label: String(v) };
					});
					if (!Array.isArray(series) || series.length === 0) {
						return { viewBox: `0 0 ${w} ${h}`, width: w, height: h, empty: true, mel: null, rri: null, gap: null, xTicks: xTicks, yGrid: yGrid, current: [], hoverData: [] };
					}
					// 按真实 timestamp 定位每个点
					const coords = series.map(function (point) {
						const ms = timeMs(point.time);
						return {
							x: scaleTimeX(ms, startMs, endMs, area),
							melY: scaleY(normalizeTo100(point.mel != null ? point.mel / 2 : null, MEL_MAX / 2), area),
							rriY: scaleY(normalizeTo100(point.rri, RRI_MAX), area),
							mel: point.mel,
							rri: point.rri,
							time: point.time,
							timeMs: ms,
							summary: point.summary ?? "",
						};
					});
					const melPath = polylinePath(coords.map(function (c) { return { x: c.x, y: c.melY }; }));
					const rriPath = polylinePath(coords.map(function (c) { return { x: c.x, y: c.rriY }; }));
					// Gap area: normalized MEL/2 vs RRI
					var gapPath = "";
					if (coords.length >= 2) {
						var lastBothKnown = false;
						var segStart = -1;
						for (var i = 0; i < coords.length; i++) {
							var both = coords[i].melY != null && coords[i].rriY != null;
							if (both && !lastBothKnown) segStart = i;
							if (!both && lastBothKnown && segStart >= 0) {
								gapPath += buildGapSegment(coords, segStart, i);
								segStart = -1;
							}
							lastBothKnown = both;
						}
						if (lastBothKnown && segStart >= 0) gapPath += buildGapSegment(coords, segStart, coords.length);
					}
					// 当前值端点（最后一个非空值）
					var melLast = lastNonNull(series, "mel");
					var rriLast = lastNonNull(series, "rri");
					var current = [];
					if (melLast) {
						var melMs = timeMs(series[melLast.index].time);
						current.push({
							label: "MEL", value: melLast.value,
							normalized: Math.round(melLast.value / 2),
							x: scaleTimeX(melMs, startMs, endMs, area), y: scaleY(normalizeTo100(melLast.value / 2, MEL_MAX / 2), area),
							color: MEL_COLOR,
						});
					}
					if (rriLast) {
						var rriMs = timeMs(series[rriLast.index].time);
						current.push({
							label: "RRI", value: rriLast.value,
							normalized: rriLast.value,
							x: scaleTimeX(rriMs, startMs, endMs, area), y: scaleY(normalizeTo100(rriLast.value, RRI_MAX), area),
							color: RRI_COLOR,
						});
					}
					// hover 数据
					var hoverData = coords.map(function (c, i) {
						return {
							index: i,
							x: c.x,
							melY: c.melY,
							rriY: c.rriY,
							mel: c.mel,
							rri: c.rri,
							normalizedMel: c.mel != null ? Math.round(c.mel / 2) : null,
							gap: (typeof c.mel === "number" && typeof c.rri === "number") ? Math.round((c.mel / 2 - c.rri) * 100) / 100 : null,
							time: c.time,
							timeMs: c.timeMs,
							summary: c.summary,
						};
					});
					return {
						viewBox: `0 0 ${w} ${h}`,
						width: w,
						height: h,
						empty: false,
						mel: melPath ? { path: melPath, color: MEL_COLOR, label: "MEL", last: melLast ? melLast.value : null } : null,
						rri: rriPath ? { path: rriPath, color: RRI_COLOR, label: "RRI", last: rriLast ? rriLast.value : null } : null,
						gap: gapPath ? { path: gapPath } : null,
						xTicks: xTicks,
						yGrid: yGrid,
						current: current,
						hoverData: hoverData,
					};
				}

				/** HH:mm 格式（tooltip 用更完整的时间）。 */
				function localClock(iso) {
					try {
						const d = new Date(String(iso));
						if (Number.isNaN(d.getTime())) return "";
						const hh = String(d.getHours()).padStart(2, "0");
						const mm = String(d.getMinutes()).padStart(2, "0");
						return `${hh}:${mm}`;
					} catch {
						return "";
					}
				}

				/** Tooltip 用的完整时间文字（含日期，跨日时尤其需要）。 */
				function localTimeFull(iso) {
					try {
						const d = new Date(String(iso));
						if (Number.isNaN(d.getTime())) return "";
						const MM = String(d.getMonth() + 1).padStart(2, "0");
						const DD = String(d.getDate()).padStart(2, "0");
						const hh = String(d.getHours()).padStart(2, "0");
						const mm = String(d.getMinutes()).padStart(2, "0");
						return `${MM}-${DD} ${hh}:${mm}`;
					} catch {
						return "";
					}
				}
				//#endregion
