// Generated source fragment. Edit this file, then run npm run build:client.
			//#region IntrospectWorkspace（壳无关面板组件：slot-agnostic，sidebar/standalone 共用）
			/**
			 * 主面板组件：五指标、MEL × RRI 曲线、Recent Events、事件详情。
			 * 面板数据全部来自 face.fetchDashboard()，工具结果的 introspectFingerprint
			 * 每次变化就重新拉一次（零通道、无轮询）。
			 *
			 * props：
			 *   sessionId        会话 id
			 *   introspectFace   { fetchDashboard, readEvent, setDraft, revokeApproval }
			 *   nodesVersion     introspectFingerprint 返回值，变化=有新事件，触发 refetch
			 *   visible          boolean（面板是否可见；不可见时仍挂载，但跳过拉取）
			 *   onAutoOpen       新事件到达且面板收起时，父级据此拉起面板
			 *   headerHeight     面板头部对齐高度（standalone 壳传入，sidebar 壳传 null）
			 *   variant          "standalone" | "sidebar"
			 */
			function IntrospectWorkspace(props) {
				const { sessionId, introspectFace: face, nodesVersion, visible, onAutoOpen, headerHeight, variant } = props;
				const [dashboard, setDashboard] = react.useState(null);
				const [loading, setLoading] = react.useState(false);
				const [error, setError] = react.useState(null);
				const [detailId, setDetailId] = react.useState(null);
				const [detail, setDetail] = react.useState(null);
				const [detailLoading, setDetailLoading] = react.useState(false);
				const [hovered, setHovered] = react.useState(null);
				const seenVersionRef = react.useRef(null);
				const pendingRef = react.useRef(null);

				// 拉取面板数据：有新 fingerprint 就重新拉。
				const refresh = react.useCallback(async () => {
					if (!face || typeof face.fetchDashboard !== "function") return;
					if (pendingRef.current) return;
					setLoading(true);
					pendingRef.current = true;
					try {
						const value = await face.fetchDashboard(sessionId);
						if (value && value.ok) {
							setDashboard(value);
							setError(null);
						}
					} catch (e) {
						if (e) setError(e.message ?? "fetch failed");
					} finally {
						pendingRef.current = null;
						setLoading(false);
					}
				}, [face, sessionId]);

				// fingerprint 变化时：如果面板可见，立即刷新；如果不可见，让父级
				// 拉起面板（新事件到达时应该看到它）。第一次只记基线，不弹窗。
				react.useEffect(() => {
					if (!nodesVersion) return;
					if (seenVersionRef.current === null) {
						seenVersionRef.current = nodesVersion;
						if (visible) refresh();
						return;
					}
					if (nodesVersion !== seenVersionRef.current) {
						seenVersionRef.current = nodesVersion;
						if (visible) refresh();
						else if (typeof onAutoOpen === "function") onAutoOpen();
					}
				}, [nodesVersion, visible, refresh, onAutoOpen]);

				// 面板变可见时：第一次或有错误就拉一次。
				react.useEffect(() => {
					if (visible && !dashboard && !loading) refresh();
				}, [visible, dashboard, loading, refresh]);

				// 事件详情：点 recent 事件后按 id 拉取。
				const openDetail = react.useCallback(async (id) => {
					if (!face || typeof face.readEvent !== "function") return;
					setDetailId(id);
					setDetailLoading(true);
					try {
						const event = await face.readEvent(sessionId, id);
						setDetail(event);
					} catch {
						setDetail(null);
					} finally {
						setDetailLoading(false);
					}
				}, [face, sessionId]);

				const closeDetail = react.useCallback(() => {
					setDetailId(null);
					setDetail(null);
				}, []);

				if (detailId !== null) {
					return (0, react_jsx_runtime.jsx)(DetailPanel, {
						detail: detail,
						loading: detailLoading,
						onBack: closeDetail,
						variant,
					});
				}

				if (loading && !dashboard) {
					return (0, react_jsx_runtime.jsx)("div", { style: S.loadingWrap, children: "Loading…" });
				}

				if (error && !dashboard) {
					return (0, react_jsx_runtime.jsxs)("div", { style: S.emptyWrap, children: [
						(0, react_jsx_runtime.jsx)("div", { style: S.emptyIcon, children: "⚠" }),
						(0, react_jsx_runtime.jsx)("p", { style: S.emptyTitle, children: "Load failed" }),
						(0, react_jsx_runtime.jsx)("p", { style: S.emptyHint, children: error }),
					] });
				}

				if (!dashboard || dashboard.totals.count === 0) {
					return (0, react_jsx_runtime.jsxs)("div", { style: S.emptyWrap, children: [
						(0, react_jsx_runtime.jsx)("div", { style: S.emptyIcon, children: "◎" }),
						(0, react_jsx_runtime.jsx)("p", { style: S.emptyTitle, children: "Nothing recorded yet." }),
						(0, react_jsx_runtime.jsx)("p", { style: S.emptyHint, children: "Start with one event." }),
						typeof face?.setDraft === "function" ? (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: S.emptyHint,
							onClick: () => face.setDraft("记录一下："),
							children: "＋ Record",
						}) : null,
					] });
				}

				const chart = buildChartPaths(dashboard.series, 300, 120);
				return (0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
					(0, react_jsx_runtime.jsxs)("div", { style: S.header, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between" }, children: [
							(0, react_jsx_runtime.jsx)("h3", { style: S.headerTitle, children: "Introspect" }),
							(0, react_jsx_runtime.jsx)("button", { type: "button", style: S.refreshBtn, onClick: refresh, children: loading ? "…" : "↻" }),
						] }),
						(0, react_jsx_runtime.jsx)(MetricsGrid, { today: dashboard.today, window: dashboard.window }),
						dashboard.today.gap !== null ? (0, react_jsx_runtime.jsxs)("div", { style: S.gapRow, children: [
							(0, react_jsx_runtime.jsx)("span", { children: "Energy − Reality (raw)" }),
							(0, react_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: signed(dashboard.today.gap) }),
						] }) : null,
					] }),
					dashboard.series.length > 0 ? (0, react_jsx_runtime.jsxs)("div", { style: S.chartWrap, children: [
						(0, react_jsx_runtime.jsxs)("div", { style: S.chartHeader, children: [
							(0, react_jsx_runtime.jsx)("span", { children: `Last ${dashboard.hours}h` }),
							(0, react_jsx_runtime.jsx)("div", { style: S.chartLegend, children: chart.legend.map((item) =>
								(0, react_jsx_runtime.jsxs)("span", { style: S.legendItem, children: [
									(0, react_jsx_runtime.jsx)("span", { style: { ...S.legendDot, background: item.color } }),
									(0, react_jsx_runtime.jsxs)("span", { style: S.legendLabel, children: [item.label, " ", item.value ?? "-"] }),
								] }, item.label)
							) }),
						] }),
						(0, react_jsx_runtime.jsx)(MelRriChart, { chart: chart }),
					] }) : null,
					dashboard.recent.length > 0 ? (0, react_jsx_runtime.jsxs)("div", { style: S.recentWrap, children: [
						(0, react_jsx_runtime.jsx)("div", { style: S.recentHeader, children: "Recent" }),
						dashboard.recent.map((event) =>
							(0, react_jsx_runtime.jsxs)("div", {
								style: hovered === event.id ? { ...S.recentItem, ...S.recentItemHover } : S.recentItem,
								onMouseEnter: () => setHovered(event.id),
								onMouseLeave: () => setHovered(null),
								onClick: () => openDetail(event.id),
								children: [
									(0, react_jsx_runtime.jsxs)("div", { style: S.recentTop, children: [
										(0, react_jsx_runtime.jsx)("span", { style: S.recentSummary, children: event.summary }),
										(0, react_jsx_runtime.jsx)("span", { style: S.recentTime, children: event.clock || event.stamp }),
									] }),
									(0, react_jsx_runtime.jsxs)("div", { style: S.recentMetrics, children: [
										event.mel != null ? (0, react_jsx_runtime.jsx)("span", { style: S.recentMetricChip, children: `MEL ${event.mel}` }) : null,
										event.rri != null ? (0, react_jsx_runtime.jsx)("span", { style: S.recentMetricChip, children: `RRI ${event.rri}` }) : null,
										event.tsaMinutes != null ? (0, react_jsx_runtime.jsx)("span", { style: S.recentMetricChip, children: formatMinutes(event.tsaMinutes) }) : null,
									] }),
								],
							}, event.id)
						),
					] }) : null,
					(0, react_jsx_runtime.jsx)("div", { style: S.footer, children: (0, react_jsx_runtime.jsx)("span", { children: "Local SQLite · No upload" }) }),
				] });
			}

			/** 五指标网格：latest + band + trend/avg 子行。 */
			function MetricsGrid(props) {
				const { today } = props;
				const cells = [
					{ label: "MEL", value: today.mel, sub: today.melDirection !== "flat" ? `${today.melDirection === "up" ? "↗" : today.melDirection === "down" ? "↘" : "→"} ${today.melDirection}` : "→ flat" },
					{ label: "RRI", value: today.rri, sub: today.rriAvg != null ? `avg ${today.rriAvg}` : null },
					{ label: "ROI", value: today.roi, sub: "today" },
					{ label: "ARCTIC", value: today.arctic, sub: "Σ" },
					{ label: "TSA", value: today.tsaText, sub: `${today.count} events` },
				];
				return (0, react_jsx_runtime.jsx)("div", { style: S.metricsGrid, children: cells.map((cell) =>
					(0, react_jsx_runtime.jsxs)("div", { style: S.metricCell, children: [
						(0, react_jsx_runtime.jsx)("span", { style: S.metricLabel, children: cell.label }),
						(0, react_jsx_runtime.jsx)("span", { style: S.metricValue, children: cell.value ?? "-" }),
						cell.sub ? (0, react_jsx_runtime.jsx)("span", { style: S.metricSub, children: cell.sub }) : null,
					] }, cell.label)
				) });
			}

			/** MEL × RRI SVG 图表：buildChartPaths 的纯渲染。 */
			function MelRriChart(props) {
				const { chart } = props;
				if (!chart || chart.empty) return null;
				return (0, react_jsx_runtime.jsxs)("svg", {
					style: S.chartSvg,
					viewBox: chart.viewBox,
					preserveAspectRatio: "none",
					role: "img",
					"aria-label": "MEL x RRI time series",
					children: [
						chart.gap ? (0, react_jsx_runtime.jsx)("path", { d: chart.gap.path, fill: GAP_COLOR, fillOpacity: 0.08, stroke: "none" }) : null,
						chart.mel ? (0, react_jsx_runtime.jsx)("path", { d: chart.mel.path, fill: "none", stroke: chart.mel.color, strokeWidth: "1.6", strokeLinejoin: "round" }) : null,
						chart.rri ? (0, react_jsx_runtime.jsx)("path", { d: chart.rri.path, fill: "none", stroke: chart.rri.color, strokeWidth: "1.6", strokeLinejoin: "round" }) : null,
						chart.current.map((dot) =>
							(0, react_jsx_runtime.jsx)("circle", {
								cx: dot.x.toFixed(1),
								cy: dot.y.toFixed(1),
								r: "3",
								fill: dot.color,
								stroke: "var(--dsw-alias-bg-base, #fff)",
								strokeWidth: "1.2",
							}, dot.label)
						),
						chart.ticks.map((tick) =>
							(0, react_jsx_runtime.jsxs)(react.Fragment, { children: [
								(0, react_jsx_runtime.jsx)("line", { x1: tick.x, x2: tick.x, y1: CHART_PAD.top, y2: chart.height - CHART_PAD.bottom, stroke: "var(--dsw-alias-border-l2, #e5e7eb)", strokeWidth: "0.5", strokeDasharray: "2 2" }),
								(0, react_jsx_runtime.jsx)("text", { x: tick.x, y: chart.height - 4, fill: TICK_COLOR, fontSize: "9", textAnchor: "middle", fontVariantNumeric: "tabular-nums", children: tick.label }),
							] }, tick.x)
						),
					],
				});
			}

			/** 事件详情面板（点 recent 后展开）。 */
			function DetailPanel(props) {
				const { detail, loading, onBack, variant } = props;
				const S_ = variant === "sidebar" ? S : S;
				if (loading) {
					return (0, react_jsx_runtime.jsxs)("div", { style: S_.detailWrap, children: [
						(0, react_jsx_runtime.jsx)("button", { type: "button", style: S_.detailBack, onClick: onBack, children: "← Back" }),
						(0, react_jsx_runtime.jsx)("div", { style: S.loadingWrap, children: "Loading…" }),
					] });
				}
				if (!detail || !detail.event) {
					return (0, react_jsx_runtime.jsxs)("div", { style: S_.detailWrap, children: [
						(0, react_jsx_runtime.jsx)("button", { type: "button", style: S_.detailBack, onClick: onBack, children: "← Back" }),
						(0, react_jsx_runtime.jsx)("div", { style: S.emptyHint, children: "Event not found." }),
					] });
				}
				const event = detail.event;
				const rows = [
					{ label: "MEL", value: event.mel, reason: event.melReason },
					{ label: "RRI", value: event.rri, reason: event.rriReason },
					{ label: "ROI", value: event.roi != null ? signed(event.roi, 1) : null, reason: event.roiReason },
					{ label: "ARCTIC", value: event.arctic != null ? signed(event.arctic) : null, reason: event.arcticReason },
					{ label: "TSA", value: event.tsaMinutes != null ? formatMinutes(event.tsaMinutes) : null, reason: null },
				];
				return (0, react_jsx_runtime.jsxs)("div", { style: S_.detailWrap, children: [
					(0, react_jsx_runtime.jsx)("button", { type: "button", style: S_.detailBack, onClick: onBack, children: "← Back" }),
					(0, react_jsx_runtime.jsx)("p", { style: S_.detailSummary, children: event.summary }),
					event.rawText ? (0, react_jsx_runtime.jsx)("pre", { style: S_.detailRaw, children: event.rawText }) : null,
					(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }, children: [
						rows.map((row) =>
							(0, react_jsx_runtime.jsxs)("div", { children: [
								(0, react_jsx_runtime.jsxs)("div", { style: S_.detailRow, children: [
									(0, react_jsx_runtime.jsx)("span", { style: S_.detailLabel, children: row.label }),
									(0, react_jsx_runtime.jsx)("span", { style: S_.detailValue, children: row.value ?? "-" }),
								] }),
								row.reason ? (0, react_jsx_runtime.jsx)("p", { style: S_.detailReason, children: row.reason }) : null,
							] }, row.label)
						),
					] }),
					event.gap !== null && event.gap !== undefined ? (0, react_jsx_runtime.jsxs)("div", { style: { ...S_.detailRow, marginTop: "2px" }, children: [
						(0, react_jsx_runtime.jsx)("span", { style: S_.detailLabel, children: "Gap" }),
						(0, react_jsx_runtime.jsx)("span", { style: S_.detailValue, children: signed(event.gap) }),
					] }) : null,
					Array.isArray(event.tags) && event.tags.length > 0 ? (0, react_jsx_runtime.jsx)("div", { style: S_.detailTags, children: event.tags.map((tag) => (0, react_jsx_runtime.jsx)("span", { style: S_.detailTag, children: tag }, tag)) }) : null,
					event.eventTime ? (0, react_jsx_runtime.jsx)("p", { style: { fontSize: "10px", color: "var(--dsw-alias-label-caption)", margin: "4px 0 0" }, children: event.eventTime }) : null,
				] });
			}
			//#endregion
