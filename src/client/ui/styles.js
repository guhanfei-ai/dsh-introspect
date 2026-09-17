// Generated source fragment. Edit this file, then run npm run build:client.
				//#region 主题样式 — observability console aesthetic
				// Spacing scale: 4 · 8 · 12 · 16 · 20 · 24
				// Typography: system-ui, tabular-nums for all numeric displays
				// Colors: follow host --dsw-alias-* variables, dark-mode native
				const S = {
					// ── Header ──
					header: { padding: "16px 16px 12px", borderBottom: "1px solid var(--dsw-alias-border-l2)", flex: "none", display: "flex", flexDirection: "column", gap: "12px" },
					headerTitle: { fontSize: "11px", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--dsw-alias-label-tertiary)", margin: "0", display: "flex", alignItems: "center", gap: "8px" },
					headerSubtitle: { fontSize: "10px", color: "var(--dsw-alias-label-caption)", letterSpacing: "0.02em" },
					liveDot: { width: "6px", height: "6px", borderRadius: "50%", background: "var(--dsw-alias-state-success-primary, #10b981)", flex: "none", opacity: 0.7 },
					refreshBtn: { border: "none", background: "none", cursor: "pointer", font: "inherit", fontSize: "10px", color: "var(--dsw-alias-label-caption)", padding: "2px 4px", borderRadius: "3px", lineHeight: 1, marginLeft: "auto" },
					refreshBtnHover: { color: "var(--dsw-alias-label-secondary)" },

					// ── Hero Metrics (MEL / RRI) ──
					heroRow: { display: "flex", gap: "4px", alignItems: "stretch" },
					heroCell: { flex: "1 1 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", padding: "8px 0", borderRadius: "6px", background: "var(--dsw-alias-fill-tsp-secondary, rgba(255,255,255,0.03))" },
					heroLabel: { fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--dsw-alias-label-tertiary)" },
					heroValue: { fontSize: "28px", fontWeight: 300, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: "var(--dsw-alias-label-primary)", letterSpacing: "-0.02em" },
					heroValueNull: { fontSize: "28px", fontWeight: 300, lineHeight: 1, color: "var(--dsw-alias-label-caption)", letterSpacing: "-0.02em" },
					heroBand: { fontSize: "10px", color: "var(--dsw-alias-label-caption)", letterSpacing: "0.02em" },

					// ── Gap Strip ──
					gapStrip: { display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "6px 0", fontSize: "11px" },
					gapLabel: { color: "var(--dsw-alias-label-caption)", letterSpacing: "0.02em" },
					gapValue: { fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--dsw-alias-label-secondary)" },
					gapDirection: { fontSize: "10px", color: "var(--dsw-alias-label-caption)" },

					// ── Secondary Metrics (ROI / ARCTIC / TSA) ──
					secondaryRail: { display: "flex", gap: "1px", borderTop: "1px solid var(--dsw-alias-border-l2)", borderBottom: "1px solid var(--dsw-alias-border-l2)", flex: "none" },
					secondaryCell: { flex: "1 1 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "1px", padding: "8px 4px", background: "var(--dsw-alias-fill-tsp-secondary, rgba(255,255,255,0.02))" },
					secondaryLabel: { fontSize: "9px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--dsw-alias-label-caption)" },
					secondaryValue: { fontSize: "14px", fontWeight: 500, fontVariantNumeric: "tabular-nums", color: "var(--dsw-alias-label-secondary)" },
					secondaryValueNull: { fontSize: "14px", fontWeight: 400, color: "var(--dsw-alias-label-caption)" },
					secondaryHint: { fontSize: "9px", color: "var(--dsw-alias-label-caption)" },

					// ── Chart Section ──
					chartWrap: { padding: "12px 16px", borderBottom: "1px solid var(--dsw-alias-border-l2)", flex: "none", position: "relative" },
					chartHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", fontSize: "11px", color: "var(--dsw-alias-label-tertiary)" },
					chartRange: { fontSize: "10px", color: "var(--dsw-alias-label-caption)", letterSpacing: "0.02em" },
					chartLegend: { display: "flex", gap: "12px", fontSize: "11px" },
					legendItem: { display: "inline-flex", alignItems: "center", gap: "5px" },
					legendDot: { width: "7px", height: "7px", borderRadius: "50%", flex: "none" },
					legendLabel: { color: "var(--dsw-alias-label-tertiary)", fontSize: "10px", letterSpacing: "0.02em" },
					legendValue: { color: "var(--dsw-alias-label-secondary)", fontVariantNumeric: "tabular-nums", fontWeight: 500, fontSize: "11px" },
					chartSvg: { display: "block", width: "100%", height: "auto", cursor: "crosshair" },
					chartEmpty: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px", padding: "24px 16px", textAlign: "center" },
					chartEmptyText: { fontSize: "11px", color: "var(--dsw-alias-label-caption)" },

					// ── Tooltip (floating, positioned by JS) ──
					tooltip: { position: "absolute", pointerEvents: "none", background: "var(--dsw-alias-bg-elevated, rgba(20,20,28,0.95))", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "6px", padding: "8px 10px", fontSize: "10px", lineHeight: 1.5, zIndex: 10, minWidth: "120px", boxShadow: "0 4px 12px rgba(0,0,0,0.3)", fontVariantNumeric: "tabular-nums", transition: "opacity 0.1s ease" },
					tooltipTime: { fontSize: "11px", fontWeight: 600, color: "var(--dsw-alias-label-primary)", marginBottom: "4px", letterSpacing: "0.01em" },
					tooltipRow: { display: "flex", justifyContent: "space-between", gap: "12px", color: "var(--dsw-alias-label-secondary)" },
					tooltipLabel: { color: "var(--dsw-alias-label-tertiary)" },
					tooltipVal: { fontWeight: 500 },
					tooltipDivider: { height: "1px", background: "var(--dsw-alias-border-l2)", margin: "4px 0" },

					// ── Today Strip ──
					todayStrip: { padding: "8px 16px", borderBottom: "1px solid var(--dsw-alias-border-l2)", flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "11px" },
					todayLeft: { display: "flex", alignItems: "center", gap: "8px" },
					todayLabel: { fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--dsw-alias-label-caption)" },
					todayInfo: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary)", fontVariantNumeric: "tabular-nums" },

					// ── Recent Timeline ──
					recentWrap: { flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: "0" },
					recentHeader: { padding: "10px 16px 6px", fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--dsw-alias-label-caption)", position: "sticky", top: 0, background: "var(--dsw-alias-bg-base)", zIndex: 1 },
					recentDayGroup: { padding: "0 0 0" },
					recentDayLabel: { padding: "6px 16px 2px", fontSize: "9px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--dsw-alias-label-caption)" },
					recentItem: { padding: "8px 16px", cursor: "pointer", transition: "background 0.08s ease", borderTop: "1px solid var(--dsw-alias-border-l2)" },
					recentItemHover: { background: "var(--dsw-alias-interactive-bg-hover)" },
					recentTime: { fontSize: "10px", fontVariantNumeric: "tabular-nums", color: "var(--dsw-alias-label-caption)", marginBottom: "2px", letterSpacing: "0.01em" },
					recentSummary: { fontSize: "12px", lineHeight: 1.45, fontWeight: 400, color: "var(--dsw-alias-label-primary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
					recentChips: { display: "flex", gap: "8px", marginTop: "4px", flexWrap: "wrap" },
					chip: { fontSize: "10px", padding: "1px 6px", borderRadius: "3px", fontVariantNumeric: "tabular-nums", letterSpacing: "0.01em" },
					chipMel: { background: "color-mix(in srgb, var(--dsw-alias-state-business-primary, #6366f1) 15%, transparent)", color: "var(--dsw-alias-state-business-primary, #818cf8)" },
					chipRri: { background: "color-mix(in srgb, var(--dsw-alias-state-success-primary, #10b981) 15%, transparent)", color: "var(--dsw-alias-state-success-primary, #34d399)" },
					chipRoi: { background: "var(--dsw-alias-fill-tsp-secondary, rgba(255,255,255,0.05))", color: "var(--dsw-alias-label-tertiary)" },
					chipTsa: { background: "var(--dsw-alias-fill-tsp-secondary, rgba(255,255,255,0.05))", color: "var(--dsw-alias-label-tertiary)" },

					// ── Detail Panel ──
					detailWrap: { padding: "16px", display: "flex", flexDirection: "column", gap: "12px" },
					detailBack: { border: "none", background: "none", cursor: "pointer", font: "inherit", fontSize: "11px", color: "var(--dsw-alias-state-business-primary, #818cf8)", padding: "0", letterSpacing: "0.01em" },
					detailSummary: { fontSize: "14px", fontWeight: 500, lineHeight: 1.4, margin: "0", color: "var(--dsw-alias-label-primary)" },
					detailRaw: { fontSize: "11px", lineHeight: 1.6, color: "var(--dsw-alias-label-secondary)", margin: "0", padding: "10px 12px", background: "var(--dsw-alias-fill-tsp-secondary, rgba(255,255,255,0.03))", borderRadius: "6px", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
					detailRow: { display: "flex", justifyContent: "space-between", fontSize: "12px", gap: "8px", minHeight: "20px" },
					detailLabel: { color: "var(--dsw-alias-label-tertiary)", flex: "none", fontSize: "10px", letterSpacing: "0.04em", textTransform: "uppercase" },
					detailValue: { fontWeight: 500, textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
					detailReason: { fontSize: "11px", lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary)", margin: "2px 0 0", padding: "6px 10px", background: "var(--dsw-alias-fill-tsp-secondary, rgba(255,255,255,0.03))", borderRadius: "4px" },
					detailTags: { display: "flex", flexWrap: "wrap", gap: "4px" },
					detailTag: { fontSize: "10px", padding: "2px 8px", borderRadius: "4px", background: "var(--dsw-alias-fill-tsp-secondary, rgba(255,255,255,0.05))", color: "var(--dsw-alias-label-secondary)" },

					// ── Empty / Loading States ──
					emptyWrap: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "8px", height: "100%", padding: "40px 24px", textAlign: "center" },
					emptyTitle: { fontSize: "13px", fontWeight: 500, color: "var(--dsw-alias-label-secondary)", margin: "0" },
					emptyHint: { fontSize: "11px", color: "var(--dsw-alias-label-caption)", margin: "0", lineHeight: 1.5 },
					loadingWrap: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--dsw-alias-label-caption)", fontSize: "12px" },

					// ── Footer ──
					footer: { padding: "8px 16px", borderTop: "1px solid var(--dsw-alias-border-l2)", display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", color: "var(--dsw-alias-label-caption)", flex: "none" },
					footerDot: { width: "4px", height: "4px", borderRadius: "50%", background: "var(--dsw-alias-label-caption)", opacity: 0.5, flex: "none" },

					// ── Slot Button (header action) ──
					mButton: { display: "inline-flex", alignItems: "center", gap: "4px", padding: "0 8px", height: "22px", background: "var(--dsw-alias-fill-tsp-secondary)", color: "var(--dsw-alias-label-secondary)", border: "none", borderRadius: "6px", cursor: "pointer", font: "inherit", fontSize: "12px", whiteSpace: "nowrap" },

					// ── Panel Shell (standalone mode) ──
					panelHost: { position: "fixed", top: 0, right: 0, bottom: 0, left: 0, pointerEvents: "none", zIndex: 40 },
					overlayRoot: { position: "absolute", top: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: "13px", minWidth: 0, borderLeft: "1px solid var(--dsw-alias-border-l2)", boxShadow: "-8px 0 24px rgba(16,24,40,0.10)", pointerEvents: "auto" },
					overlayHandle: { position: "absolute", left: -4, top: 0, bottom: 0, width: 8, cursor: "col-resize", zIndex: 1 },
				};
				//#endregion
