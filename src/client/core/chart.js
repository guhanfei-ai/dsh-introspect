// Generated source fragment. Edit this file, then run npm run build:client.
			//#region MEL × RRI 纯 SVG 图表（零依赖、响应式、主题跟随）
			const CHART_PAD = { top: 8, right: 4, bottom: 20, left: 4 };
			const CHART_DEFAULTS = { width: 300, height: 120 };
			const MEL_COLOR = "var(--dsw-alias-state-business-primary, #6366f1)";
			const RRI_COLOR = "var(--dsw-alias-state-success-primary, #14b8a6)";
			const GAP_COLOR = "var(--dsw-alias-state-business-primary, #6366f1)";
			const TICK_COLOR = "var(--dsw-alias-label-tertiary, #9ca3af)";
			const MEL_MAX = 200;
			const RRI_MAX = 100;

			function plotArea(width, height) {
				const left = CHART_PAD.left;
				const top = CHART_PAD.top;
				const w = Math.max(1, width - CHART_PAD.left - CHART_PAD.right);
				const h = Math.max(1, height - CHART_PAD.top - CHART_PAD.bottom);
				return { left, top, w, h };
			}

			function scaleX(index, count, area) {
				if (count <= 1) return area.left + area.w * 0.5;
				return area.left + (index / (count - 1)) * area.w;
			}

			function scaleY(value100, area) {
				if (value100 == null || !Number.isFinite(value100)) return null;
				return area.top + area.h - Math.max(0, Math.min(100, value100)) * area.h / 100;
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

			function tickLabels(series) {
				const times = series.map((p) => p.time).filter(Boolean);
				if (times.length === 0) return [];
				const picks = [0];
				if (times.length >= 4) {
					picks.push(Math.floor(times.length * 0.33));
					picks.push(Math.floor(times.length * 0.66));
				}
				if (times.length >= 2) picks.push(times.length - 1);
				return [...new Set(picks)].filter((i) => i < times.length).sort((a, b) => a - b).map((i) => ({
					index: i,
					label: localClock(times[i]),
				}));
			}

			function lastNonNull(series, key) {
				for (let i = series.length - 1; i >= 0; i--) {
					const value = series[i][key];
					if (typeof value === "number" && Number.isFinite(value)) return { index: i, value };
				}
				return null;
			}

			/**
			 * 纯函数：从时间序列数据算出整个 SVG 的几何信息。
			 * 面板 React 组件拿到返回值后只负责渲染 JSX，不做任何计算。
			 */
			function buildChartPaths(series, width, height) {
				const w = typeof width === "number" && width > 0 ? width : CHART_DEFAULTS.width;
				const h = typeof height === "number" && height > 0 ? height : CHART_DEFAULTS.height;
				const area = plotArea(w, h);
				if (!Array.isArray(series) || series.length === 0) {
					return { viewBox: `0 0 ${w} ${h}`, width: w, height: h, empty: true, mel: null, rri: null, gap: null, ticks: [], legend: [], current: [] };
				}
				const n = series.length;
				const coords = series.map((point, i) => ({
					x: scaleX(i, n, area),
					melY: scaleY(normalizeTo100(point.mel, MEL_MAX), area),
					rriY: scaleY(normalizeTo100(point.rri, RRI_MAX), area),
					mel: point.mel,
					rri: point.rri,
					time: point.time,
					summary: point.summary ?? "",
				}));
				const melPath = polylinePath(coords.map((c) => ({ x: c.x, y: c.melY })));
				const rriPath = polylinePath(coords.map((c) => ({ x: c.x, y: c.rriY })));
				let gapPath = "";
				if (coords.length >= 2) {
					let lastBothKnown = false;
					let segStart = -1;
					for (let i = 0; i < coords.length; i++) {
						const both = coords[i].melY != null && coords[i].rriY != null;
						if (both && !lastBothKnown) segStart = i;
						if (!both && lastBothKnown && segStart >= 0) {
							gapPath += buildGapSegment(coords, segStart, i);
							segStart = -1;
						}
						lastBothKnown = both;
					}
					if (lastBothKnown && segStart >= 0) gapPath += buildGapSegment(coords, segStart, coords.length);
				}
				const ticks = tickLabels(series);
				const ticksScaled = ticks.map((t) => ({ ...t, x: scaleX(t.index, n, area).toFixed(1) }));
				const melLast = lastNonNull(series, "mel");
				const rriLast = lastNonNull(series, "rri");
				const current = [];
				if (melLast) current.push({ label: "MEL", value: melLast.value, x: scaleX(melLast.index, n, area), y: scaleY(normalizeTo100(melLast.value, MEL_MAX), area), color: MEL_COLOR });
				if (rriLast) current.push({ label: "RRI", value: rriLast.value, x: scaleX(rriLast.index, n, area), y: scaleY(normalizeTo100(rriLast.value, RRI_MAX), area), color: RRI_COLOR });
				return {
					viewBox: `0 0 ${w} ${h}`,
					width: w,
					height: h,
					empty: false,
					mel: melPath ? { path: melPath, color: MEL_COLOR, label: "MEL", last: melLast?.value ?? null } : null,
					rri: rriPath ? { path: rriPath, color: RRI_COLOR, label: "RRI", last: rriLast?.value ?? null } : null,
					gap: gapPath ? { path: gapPath } : null,
					ticks: ticksScaled,
					legend: [
						{ label: "MEL", color: MEL_COLOR, value: melLast?.value ?? null },
						{ label: "RRI", color: RRI_COLOR, value: rriLast?.value ?? null },
					],
					current,
				};
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

			/** 从时钟文字取本地时区 HH:mm（客户端用浏览器 Intl 即可，不依赖 host 时区）。 */
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
			//#endregion
