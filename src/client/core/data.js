// Generated source fragment. Edit this file, then run npm run build:client.
			//#region 会话数据与 introspect 工具结果检测
			/** 双代会话快照（0.1.2-rc.1+ useChat.legacy.nodes / ≤0.1.1 useSession.nodes）。 */
			function conversationNodesOf(s) {
				if (!s) return EMPTY_NODES;
				const legacy = s.legacy;
				if (legacy && Array.isArray(legacy.nodes)) return legacy.nodes;
				return Array.isArray(s.nodes) ? s.nodes : EMPTY_NODES;
			}

			/** 工具结果文本块提取。 */
			function resultTextOfBlocks(blocks) {
				return (blocks ?? []).filter((b) => b?.type === "text").map((b) => b.text).join("\n");
			}

			/**
			 * introspect_* 节点的结构指纹：数组长度 + 逐节点身份（kind / callId /
			 * call.name / isError）。只含结构身份、不含 content 文本——流式 token 增长
			 * 不改变指纹，只有新工具结果节点出现才变。用作 useChat 的第二 selector，
			 * 值比较天然绕过引用相等短路。
			 */
			function introspectFingerprint(nodes) {
				if (!Array.isArray(nodes)) return "[]";
				const parts = [String(nodes.length)];
				const visit = (node, depth) => {
					if (!node || typeof node !== "object") { parts.push("·"); return; }
					if (node.kind === "tool-result") {
						const name = node.call?.name;
						if (typeof name === "string" && INTROSPECT_TOOLS.has(name)) {
							parts.push(String(node.callId ?? ""), name, node.isError ? "E" : "-");
						}
					}
					const subCalls = Array.isArray(node.subCalls) ? node.subCalls : null;
					if (subCalls && depth < 100) {
						for (const subCall of subCalls) visit(subCall, depth + 1);
					}
				};
				for (const node of nodes) visit(node, 0);
				return parts.join("|");
			}

			/**
			 * 从会话节点树里找到最近一次 introspect_record 的 id（面板用它来
			 * 突出「刚记录」的事件）。递归走 subCalls（Code 等工具会嵌套结果）。
			 */
			function latestRecordedId(nodes) {
				if (!Array.isArray(nodes)) return null;
				let best = null;
				let bestKey = "";
				const visited = new WeakSet();
				function walk(node, pathKey) {
					if (!node || typeof node !== "object" || visited.has(node)) return;
					visited.add(node);
					if (node.kind === "tool-result" && node.call?.name === "introspect_record" && !node.isError) {
						const text = resultTextOfBlocks(node.content);
						let parsed;
						try { parsed = JSON.parse(text); } catch { parsed = null; }
						if (parsed && parsed.ok === true && parsed.event?.id != null) {
							const callId = node.callId ?? node.call?.callId;
							const key = callId != null ? `call:${String(callId)}` : `node:${pathKey}`;
							if (key > bestKey) { best = parsed.event.id; bestKey = key; }
						}
					}
					const subCalls = Array.isArray(node.subCalls) ? node.subCalls : null;
					if (subCalls) {
						for (let i = 0; i < subCalls.length; i++) walk(subCalls[i], `${pathKey}/${i}`);
					}
				}
				for (let i = 0; i < nodes.length; i++) walk(nodes[i], String(i));
				return typeof best === "number" ? best : null;
			}

			/** 归一化到0-100 同轴绘图（不改数据库里的原始值）。 */
			function normalizeTo100(value, max) {
				if (typeof value !== "number" || !Number.isFinite(value)) return null;
				if (typeof max !== "number" || max <= 0) return null;
				return Math.max(0, Math.min(100, (value / max) * 100));
			}

			/** 分钟→紧凑展示（122→2h02m）。 */
			function formatMinutes(minutes) {
				if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return null;
				const total = Math.round(minutes);
				const hours = Math.floor(total / 60);
				const mins = total % 60;
				if (hours === 0) return `${mins}m`;
				if (mins === 0) return `${hours}h`;
				return `${hours}h${String(mins).padStart(2, "0")}m`;
			}

			/** 有符号数展示。 */
			function signed(value, digits) {
				if (typeof value !== "number" || !Number.isFinite(value)) return null;
				const d = typeof digits === "number" ? digits : 0;
				const rounded = Number(value.toFixed(d));
				const text = d > 0 ? rounded.toFixed(d) : String(rounded);
				return rounded > 0 ? `+${text}` : text;
			}

			/** 码位安全的有界截断（附省略号）。 */
				function trimForList(text, limit) {
					const chars = [...String(text ?? "")];
					const cap = typeof limit === "number" && limit > 0 ? limit : 120;
					if (chars.length <= cap) return String(text ?? "");
					return `${chars.slice(0, cap - 1).join("")}…`;
				}

				/** Normalized Energy-Reality Gap: MEL/2 - RRI，同轴语义一致。 */
				function normalizedGap(mel, rri) {
					if (typeof mel !== "number" || typeof rri !== "number") return null;
					return Math.round((mel / 2 - rri) * 100) / 100;
				}

				/** Gap 方向文字（克制、无判断）。 */
				function gapDirectionText(gap) {
					if (typeof gap !== "number" || !Number.isFinite(gap)) return "";
					if (Math.abs(gap) < 1) return "aligned";
					return gap > 0 ? "energy ahead" : "reality ahead";
				}

				/** 客户端 MEL 区间查找（与 src/metrics.js MEL_BANDS 一致）。 */
				function melBand(value) {
					if (typeof value !== "number" || !Number.isFinite(value)) return null;
					if (value < 60) return { key: "low", label: "low energy" };
					if (value < 80) return { key: "normal", label: "balanced" };
					if (value < 100) return { key: "high", label: "creative" };
					return { key: "over", label: "over-limit" };
				}

				/** 客户端 RRI 区间查找（与 src/metrics.js RRI_BANDS 一致）。 */
				function rriBand(value) {
					if (typeof value !== "number" || !Number.isFinite(value)) return null;
					if (value <= 20) return { key: "very_low", label: "very low" };
					if (value <= 40) return { key: "low", label: "low" };
					if (value <= 60) return { key: "medium", label: "medium" };
					if (value <= 80) return { key: "high", label: "high" };
					return { key: "very_high", label: "very high" };
				}

				/** 七档固定时间窗口。 */
				var CHART_HOURS_OPTIONS = [1, 3, 6, 12, 24, 48, 72];
				var DEFAULT_CHART_HOURS = 1;

				/** 格式化 range label。 */
				function formatHoursLabel(h) {
					if (h <= 1) return "1H";
					return h + "H";
				}

				/** 构建 timeWindow 对象（供 buildChartPaths 使用）。 */
				function makeTimeWindow(hours, generatedAt) {
					var endMs = generatedAt ? new Date(generatedAt).getTime() : Date.now();
					if (!Number.isFinite(endMs)) endMs = Date.now();
					return { startMs: endMs - hours * 3600000, endMs: endMs, hours: hours };
				}
			//#endregion
