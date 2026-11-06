window.__ModuleLoader__.load({
  id: "dsh-deck-workbench",
  factory: (require) => {
    var exports = {};
    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect, useMemo, useRef } = React;

    const services = { sessions: null, uiWorkspace: null, workspaces: null };
    const ACCENT = "#AD0101";
    const BORDER = "var(--dsw-alias-border-l1, rgba(128,128,128,.22))";
    const SOFT_BORDER = "rgba(128,128,128,.20)";
    const MUTED = "var(--dsw-alias-label-secondary, rgba(128,128,128,.78))";
    const FAINT = "var(--dsw-alias-label-tertiary, rgba(128,128,128,.62))";
    // Settings typography scale. Use these tokens instead of ad-hoc fontSize/color pairs.
    const TYPE = {
      display: { fontSize: 20, lineHeight: 1.3, fontWeight: 650, letterSpacing: "-.015em" },
      brand: { fontSize: 18, lineHeight: 1.3, fontWeight: 650, letterSpacing: "-.01em" },
      section: { fontSize: 13.5, lineHeight: 1.45, fontWeight: 650, letterSpacing: ".005em" },
      item: { fontSize: 13, lineHeight: 1.5, fontWeight: 650 },
      body: { fontSize: 12.5, lineHeight: 1.75, fontWeight: 400 },
      prompt: { fontSize: 12.5, lineHeight: 1.8, fontWeight: 400, whiteSpace: "pre-wrap" },
      label: { fontSize: 11, lineHeight: 1.5, fontWeight: 500 },
      caption: { fontSize: 10.5, lineHeight: 1.65, fontWeight: 400 },
      meta: { fontSize: 9.5, lineHeight: 1.5, fontWeight: 500, letterSpacing: ".08em" },
      control: { fontSize: 11.5, lineHeight: 1.5, fontWeight: 500 },
    };
    const SOFT = "var(--dsw-alias-bg-layer-2, rgba(128,128,128,.07))";
    const SURFACE = "var(--dsw-alias-bg-layer-1, #1f1f1f)";
    const TEXT = "var(--dsw-alias-label-primary, inherit)";
    const TARGET_ORDER = ["pptx", "image", "html"];
    const TARGET_LABELS = { pptx: "PPTX", image: "图片", html: "HTML" };
    const DEFAULT_RENDER_PROMPTS = {
      default: "按技能默认规则决定版式与文案取舍。",
      preserve: "本页文案必须完全保留，不得增删、替换或改写文字内容；只允许断行、分段和版式层级调整。如果页面放不下，停止制作并说明容量不足，不要自行删减。",
      compress: "本页允许为版式需要取词、删词、断行、短标题提炼和层级重组；不得新增内容，不得改变事实、数据、主体、承诺与结论，关键数字、专有名词和限定语必须保留。如果压缩导致语义变化，停止并说明。",
    };
    const DEFAULT_START_INSTRUCTION = "请使用 page-content 技能：先读取需求，输出项目框架与页面蓝图；等我确认蓝图后，再逐页写 content/pages/P01.md、P02.md……\n不要写版式、页面类型/关系、机器编号或视觉建议；只交内容。";
    const DEFAULT_OPTIMIZE_INSTRUCTION = "请只优化这一页，保留其他页面不变。先读取当前文案，再按下面的反馈修改，并把结果写回同一路径。\n不要添加版式、页面类型/关系、机器编号或视觉建议。";
    const DEFAULT_TARGET_NOTES = {
      html: "输出独立可打开的 HTML，1920×1080。",
      image: "生成前按 imagegen 规则向我确认提示词、尺寸和参考图。",
      pptx: "输出单页原生可编辑 PPTX；如果只能整份输出，写到 renders/pptx/deck.pptx。",
    };
    const DEFAULT_CONTENT_PROMPT = "页数按需求与蓝图确定，默认控制在 12–18 页；先输出项目框架和页面蓝图，确认后再逐页写；优先使用表格、分点和矩阵等可扫读结构；不虚构客户事实、数据、政策或案例。";
    const DEFAULT_SKILLS = {
      content: "page-content",
      pptx: "ppt-layout",
      html: "html-layout",
      image: "image-layout",
    };
    const DEFAULT_CONTENT_INSTRUCTION = [
      "请直接读取需求，输出项目框架与页面蓝图；等我确认蓝图后，再逐页写 content/pages/P01.md、P02.md……",
      "每页在标题下写一小段提纲挈领的总领段（约 60–120 字），概括本页核心内容；从页面内容本身提炼，不虚构事实、数据或结论，不要写成空泛套话。",
      "不要写版式、页面类型/关系、机器编号或视觉建议；只交内容。",
      "不要虚构客户事实；缺少信息先问。",
      "本次不调用内容技能；请独立完成，不要因为缺少技能停下。",
    ];
    const DEFAULT_SETTINGS = {
      projectsRoot: "",
      referencesRoot: "",
      contentMode: "skill",
      skills: { ...DEFAULT_SKILLS },
      contentPrompt: DEFAULT_CONTENT_PROMPT,
      contentFallbackPrompt: DEFAULT_CONTENT_INSTRUCTION.join("\n"),
      renderPrompts: { ...DEFAULT_RENDER_PROMPTS },
    };
    const MONO = "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace";

    function referenceLibraryList(reference, libraries) {
      if (Array.isArray(libraries) && libraries.length) return libraries;
      if (reference?.root) {
        const name = reference.name || String(reference.root)
          .split(String.fromCharCode(92)).join("/")
          .split("/").filter(Boolean).pop() || "当前参考库";
        return [{ ...reference, id: reference.id || "current", name, active: true }];
      }
      return [];
    }

    const S = {
      root: { height: "100%", minHeight: 0, display: "flex", flexDirection: "column", color: TEXT, fontSize: 13, fontFamily: "inherit", overflow: "hidden" },
      top: { display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${BORDER}`, flex: "0 0 auto", flexWrap: "wrap" },
      body: { flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: 18 },
      h1: { margin: 0, fontSize: 18, fontWeight: 650, letterSpacing: "0.01em" },
      h2: { margin: 0, fontSize: 14, fontWeight: 650 },
      muted: { color: MUTED, fontSize: 12 },
      button: { appearance: "none", border: `1px solid ${SOFT_BORDER}`, background: "transparent", color: "inherit", borderRadius: 7, padding: "6px 11px", fontSize: 12, fontFamily: "inherit", cursor: "pointer", lineHeight: 1.35 },
      primary: { appearance: "none", border: `1px solid ${ACCENT}`, background: ACCENT, color: "#fff", borderRadius: 7, padding: "7px 13px", fontSize: 12, fontFamily: "inherit", cursor: "pointer", fontWeight: 600, lineHeight: 1.35 },
      ghost: { appearance: "none", border: "1px solid transparent", background: "transparent", color: "inherit", borderRadius: 7, padding: "6px 9px", fontSize: 12, fontFamily: "inherit", cursor: "pointer", lineHeight: 1.35 },
      input: { width: "100%", boxSizing: "border-box", border: `1px solid ${SOFT_BORDER}`, background: "var(--dsw-alias-bg-base, rgba(128,128,128,.08))", color: TEXT, borderRadius: 7, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", outline: "none" },
      grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 },
      card: {
        border: `1px solid ${SOFT_BORDER}`,
        borderColor: "color-mix(in srgb, currentColor 14%, transparent)",
        background: SOFT,
        borderRadius: 12,
        padding: 14,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        transition: "border-color .16s ease, box-shadow .16s ease, transform .16s ease",
        outline: "none",
      },
      cardHover: {
        borderColor: `${ACCENT}88`,
        boxShadow: "0 10px 26px rgba(0,0,0,.13)",
        transform: "translateY(-1px)",
      },
      badge: { display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 999, padding: "2px 7px", fontSize: 11, fontFamily: "inherit", border: `1px solid ${SOFT_BORDER}`, color: MUTED, whiteSpace: "nowrap" },
      overlay: { position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
      modal: { width: "min(720px, 96vw)", maxHeight: "90vh", overflow: "auto", background: SURFACE, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, boxShadow: "0 24px 64px rgba(0,0,0,.32)" },
      modalWide: { width: "min(1040px, 96vw)", maxHeight: "90vh", overflow: "hidden", background: SURFACE, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 0, boxShadow: "0 20px 60px rgba(0,0,0,.35)", display: "flex", flexDirection: "column" },
      modalFixed: { width: "min(840px, 96vw)", height: "min(720px, 88vh)", maxHeight: "90vh", boxSizing: "border-box", display: "flex", flexDirection: "column", overflow: "hidden", background: SURFACE, color: TEXT, border: `1px solid ${BORDER}`, borderRadius: 12, padding: 20, boxShadow: "0 24px 64px rgba(0,0,0,.32)" },
      modalBody: { flex: "1 1 auto", minHeight: 0, overflow: "auto", scrollbarGutter: "stable", paddingBottom: 2 },
      row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
      label: { display: "block", ...TYPE.label, color: MUTED, marginBottom: 4 },
      field: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 },
      split: { flex: "1 1 auto", minHeight: 0, display: "grid", gridTemplateColumns: "170px minmax(220px, .9fr) minmax(300px, 1.1fr)", gap: 0, borderTop: `1px solid ${BORDER}` },
      resizer: { width: 6, cursor: "col-resize", background: BORDER, alignSelf: "stretch", touchAction: "none" },
      pane: { minHeight: 0, overflow: "auto", padding: 14 },
      pageItem: { width: "100%", textAlign: "left", border: "1px solid transparent", background: "transparent", color: "inherit", borderRadius: 8, padding: "8px 9px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4 },
      pageItemActive: { width: "100%", textAlign: "left", border: `1px solid ${ACCENT}55`, background: `${ACCENT}12`, color: "inherit", borderRadius: 8, padding: "8px 9px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4 },
      dot: { width: 7, height: 7, borderRadius: 999, display: "inline-block" },
      pre: { margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", fontSize: 12.5, lineHeight: 1.75, userSelect: "text" },
      tabs: { display: "flex", gap: 4, borderBottom: `1px solid ${BORDER}`, padding: "0 14px", flex: "0 0 auto" },
      tab: { appearance: "none", border: 0, borderBottom: "2px solid transparent", background: "transparent", color: MUTED, padding: "9px 10px", fontSize: 12, fontFamily: "inherit", cursor: "pointer" },
      tabActive: { appearance: "none", border: 0, borderBottom: `2px solid ${ACCENT}`, background: "transparent", color: "inherit", padding: "9px 10px", fontSize: 12, fontFamily: "inherit", cursor: "pointer", fontWeight: 600 },
      toast: { position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 1200, background: "#222", color: "#fff", borderRadius: 8, padding: "9px 14px", fontSize: 12, maxWidth: "80vw", boxShadow: "0 8px 30px rgba(0,0,0,.3)" },
      matrix: { marginTop: 12, border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10, background: SOFT },
      table: { width: "100%", borderCollapse: "collapse", fontSize: 11.5 },
      th: { textAlign: "left", color: MUTED, fontWeight: 500, padding: "5px 7px", borderBottom: `1px solid ${BORDER}` },
      td: { padding: "5px 7px", borderBottom: `1px solid ${BORDER}55`, whiteSpace: "nowrap" },
    };

    function endpoint(path) {
      const rel = `deck-workbench/${String(path || "").replace(/^\/+/, "")}`;
      if (typeof document === "undefined") return `/${rel}`;
      const url = new URL(rel, document.baseURI);
      return `${url.pathname}${url.search}`;
    }

    async function requestJson(path, options = {}) {
      const headers = { ...(options.headers || {}) };
      let body = options.body;
      if (body && typeof body === "object" && !(body instanceof Blob) && !(body instanceof FormData)) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(body);
      }
      const response = await fetch(endpoint(path), { cache: "no-store", ...options, headers, body });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      return data || {};
    }

    function fileUrl(projectId, rel) {
      const path = String(rel || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
      return endpoint(`files/${encodeURIComponent(projectId)}/${path}`);
    }

    function previewPptxUrl(projectId, pageId, format = "image") {
      return endpoint(`api/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(pageId)}/preview?target=pptx&format=${encodeURIComponent(format)}`);
    }

    async function copy(text) {
      try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
    }

    function formatTime(value) {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    }

    function statusColor(status) {
      if (status === "done") return "#2e7d32";
      if (status === "stale") return "#b26a00";
      if (status === "deck") return "#1565c0";
      return "rgba(128,128,128,.35)";
    }

    function statusText(status) {
      return ({ done: "已生成", stale: "过期", missing: "缺失", deck: "整份" })[status] || status;
    }

    function statusDot(status) {
      return h("span", { style: { ...S.dot, background: statusColor(status) }, title: statusText(status) });
    }

    function ProjectCard({ project, onOpen }) {
      const [hover, setHover] = useState(false);
      const pages = Number(project.pageCount || 0);
      const approved = Number(project.copyApproved || 0);
      const targetCounts = TARGET_ORDER
        .map((key) => [key, Number(project.renders?.[key] || 0)])
        .filter(([, count]) => count > 0);
      const ratio = pages ? Math.min(1, approved / pages) : 0;
      return h("div", {
        style: { ...S.card, ...(hover ? S.cardHover : null) },
        onClick: () => void onOpen(),
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        onFocus: () => setHover(true),
        onBlur: () => setHover(false),
        role: "button",
        tabIndex: 0,
        "aria-label": `打开项目 ${project.title}`,
        onKeyDown: (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void onOpen();
          }
        },
      },
        h("div", { style: { display: "flex", alignItems: "flex-start", gap: 10 } },
          h("div", { style: { flex: "1 1 auto", minWidth: 0 } },
            h("div", {
              style: {
                fontWeight: 650,
                fontSize: 15,
                lineHeight: 1.4,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              },
            }, project.title),
            h("div", { style: { ...S.muted, marginTop: 4 } }, project.client || "未填客户")
          ),
          h("span", {
            style: { ...S.muted, fontSize: 16, lineHeight: 1, marginTop: 1, opacity: hover ? 1 : 0.55 },
            "aria-hidden": "true",
          }, "→")
        ),
        h("div", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 2 } },
          h("span", { style: { fontSize: 11, color: MUTED, whiteSpace: "nowrap" } }, pages ? `${approved}/${pages} 页已确认` : "还没有页面"),
          pages ? h("div", { style: { flex: "1 1 auto", height: 4, borderRadius: 999, background: BORDER, overflow: "hidden" } },
            h("div", { style: { height: "100%", width: `${Math.round(ratio * 100)}%`, background: ACCENT, borderRadius: 999 } })
          ) : null
        ),
        h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
          !pages
            ? h("span", { style: { ...S.muted, fontSize: 11 } }, "打开内容对话开始")
            : targetCounts.length
              ? targetCounts.map(([key, count]) => h("span", {
                  key,
                  style: { ...S.badge, gap: 4, fontSize: 10.5 },
                }, statusDot("done"), `${TARGET_LABELS[key]} ${count}`))
              : h("span", { style: { ...S.muted, fontSize: 11 } }, "还没有产物")
        ),
        h("div", { style: { ...S.muted, paddingTop: 2, fontSize: 10.5 } }, `更新 ${formatTime(project.updatedAt)}`)
      );
    }

    function Button({ children, onClick, variant, disabled, title, style }) {
      const base = variant === "primary" ? S.primary : variant === "ghost" ? S.ghost : S.button;
      return h("button", { type: "button", onClick, disabled, title, style: { ...base, opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer", ...style } }, children);
    }

    function Field({ label, children, style }) {
      return h("label", { style: { ...S.field, ...style } }, h("span", { style: S.label }, label), children);
    }

    function Empty({ text }) {
      return h("div", { style: { color: MUTED, padding: 20, textAlign: "center", lineHeight: 1.7 } }, text);
    }

    function Toast({ text }) {
      if (!text) return null;
      return h("div", { style: S.toast }, text);
    }

    function Icon({ size = 16, active = false }) {
      return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
        h("rect", { x: 2.75, y: 4.25, width: 18.5, height: 12.5, rx: 2, stroke: "currentColor", strokeWidth: 1.5, opacity: active ? 1 : 0.9 }),
        h("path", { d: "M8 20.5h8M12 16.75v3.75", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" }),
        h("rect", { x: 6, y: 7, width: 5.5, height: 7, rx: 0.75, fill: ACCENT }),
        h("path", { d: "M14 7.75h3.5M14 10.25h3.5M14 12.75h2.5", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" })
      );
    }

    // Lucide icons, ISC license: sliders-horizontal, library, settings.
    function SettingsIcon({ name, size = 14 }) {
      const common = { stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" };
      let children;
      if (name === "sliders") {
        children = [
          h("line", { key: "a", x1: 21, x2: 14, y1: 4, y2: 4, ...common }),
          h("line", { key: "b", x1: 10, x2: 3, y1: 4, y2: 4, ...common }),
          h("line", { key: "c", x1: 21, x2: 12, y1: 12, y2: 12, ...common }),
          h("line", { key: "d", x1: 8, x2: 3, y1: 12, y2: 12, ...common }),
          h("line", { key: "e", x1: 21, x2: 16, y1: 20, y2: 20, ...common }),
          h("line", { key: "f", x1: 12, x2: 3, y1: 20, y2: 20, ...common }),
          h("line", { key: "g", x1: 14, x2: 14, y1: 2, y2: 6, ...common }),
          h("line", { key: "h", x1: 8, x2: 8, y1: 10, y2: 14, ...common }),
          h("line", { key: "i", x1: 16, x2: 16, y1: 18, y2: 22, ...common }),
        ];
      } else if (name === "library") {
        children = [
          h("path", { key: "a", d: "m16 6 4 14", ...common }),
          h("path", { key: "b", d: "M12 6v14", ...common }),
          h("path", { key: "c", d: "M8 8v12", ...common }),
          h("path", { key: "d", d: "M4 4v16", ...common }),
        ];
      } else {
        children = [
          h("path", { key: "a", d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z", ...common }),
          h("circle", { key: "b", cx: 12, cy: 12, r: 3, ...common }),
        ];
      }
      return h("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" }, ...children);
    }

    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error, info) {
        console.error("[deck-workbench] render failed", error, info);
      }
      render() {
        if (this.state.error) {
          return h("div", { style: { padding: 24, color: "#d9534f", whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.6 } },
            "方案工作台渲染失败：",
            String(this.state.error?.message || this.state.error || "unknown error")
          );
        }
        return this.props.children;
      }
    }

    async function ensureSession(project) {
      if (project.contentSessionId && project.workspaceId) return project.contentSessionId;
      if (!services.workspaces || !services.uiWorkspace) {
        throw new Error("当前 DSH 客户端没有暴露工作区/会话服务，无法创建项目会话");
      }
      let workspaceId = project.workspaceId;
      try {
        // Re-resolve by path: an empty workspace may have been discarded, leaving a stale id.
        const workspace = await services.workspaces.create({ path: project.path });
        workspaceId = workspace.workspaceId || workspace.id;
        if (!workspaceId) throw new Error("workspaces.create 没有返回 workspaceId");
        project.workspaceId = workspaceId;
        await requestJson(`api/projects/${encodeURIComponent(project.id)}/session`, {
          method: "POST",
          body: { workspaceId },
        });
      } catch (cause) {
        if (!workspaceId) throw cause;
      }
      try {
        if (typeof services.workspaces.rename === "function") {
          await services.workspaces.rename(workspaceId, project.title);
        }
      } catch {}
      let sessionId = null;
      if (services.sessions && typeof services.sessions.create === "function") {
        try {
          // DSH session.create accepts workspaceId or cwd, never both.
          sessionId = await services.sessions.create({ workspaceId });
        } catch {
          // try the workspace connection route below
        }
      }
      if (!sessionId && typeof services.uiWorkspace.connectWorkspace === "function") {
        sessionId = await services.uiWorkspace.connectWorkspace(workspaceId);
      }
      if (!sessionId) throw new Error("无法在项目 workspace 中创建会话");
      project.contentSessionId = sessionId;
      await requestJson(`api/projects/${encodeURIComponent(project.id)}/session`, {
        method: "POST",
        body: { sessionId, workspaceId },
      });
      return sessionId;
    }

    async function openProjectSession(project, settings) {
      const sessionId = await ensureSession(project);
      let blank = false;
      if (services.sessions && typeof services.sessions.using === "function") {
        try {
          await services.sessions.using(sessionId, { source: "controllerOperation" }, (reference) => {
            blank = !!reference.binding.session.getSnapshot().blank;
          });
        } catch {}
      }
      if (services.uiWorkspace && typeof services.uiWorkspace.openSession === "function") {
        services.uiWorkspace.openSession(sessionId);
      } else {
        throw new Error("当前 DSH 客户端没有暴露 uiWorkspace.openSession");
      }
      if (blank && (project.pageCount || 0) === 0) {
        await sendToProject(project, buildStartPrompt(project, settings));
      }
      return sessionId;
    }

    async function sendToProject(project, text) {
      const sessionId = await ensureSession(project);
      if (!services.sessions || typeof services.sessions.using !== "function") {
        throw new Error("当前 DSH 客户端没有暴露 sessions.using，无法发送到对话");
      }
      await services.sessions.using(sessionId, { source: "controllerOperation" }, async (reference) => {
        const session = reference?.binding?.session;
        if (!session || typeof session.prompt !== "function") throw new Error("会话没有可用的 prompt 接口");
        const result = await session.prompt([{ type: "text", text }], "queue");
        if (result && result.ok === false) throw new Error(result.error?.message || "发送到对话失败");
      });
      if (services.uiWorkspace && typeof services.uiWorkspace.openSession === "function") {
        services.uiWorkspace.openSession(sessionId);
      }
      return sessionId;
    }

    function contentRequirement(settings) {
      const text = String(settings?.contentPrompt || "").trim();
      return text ? ["内容要求：", text] : [];
    }

    function buildOptimizePrompt(project, page, feedback, settings) {
      return [
        `项目目录：${project.path}`,
        `页面：${page.id} ${page.title}`,
        `当前文案：content/pages/${page.id}.md`,
        ...DEFAULT_OPTIMIZE_INSTRUCTION.split(/\r?\n/),
        `反馈：${feedback}`,
      ].join("\n");
    }

    function buildRenderPrompt(project, page, target, policy = "default", note = "", settings) {
      const layoutSkills = { pptx: "ppt-layout", html: "html-layout", image: "image-layout" };
      const map = {
        html: { skill: layoutSkills.html, file: `renders/html/${page.id}.html`, note: "输出独立可打开的 HTML，1920×1080。" },
        image: { skill: layoutSkills.image, file: `renders/image/${page.id}.png`, note: "生成前按 imagegen 规则向我确认提示词、尺寸和参考图。" },
        pptx: { skill: layoutSkills.pptx, file: `renders/pptx/${page.id}.pptx`, note: "输出单页原生可编辑 PPTX；如果只能整份输出，写到 renders/pptx/deck.pptx。" },
      };
      const item = map[target];
      const targetNote = item.note;
      const presets = { ...DEFAULT_RENDER_PROMPTS, ...(settings?.renderPrompts || {}) };
      const requirement = policy === "custom" && note.trim() ? note.trim() : (presets[policy] || presets.default);
      return [
        `项目目录：${project.path}`,
        `页面：${page.id} ${page.title}`,
        `源文案：content/pages/${page.id}.md`,
        `产物路径：${item.file}`,
        `请使用 ${item.skill} 为这一页制作页面。${targetNote}`,
        requirement,
        "不要回写 content/pages 下的源文案。",
      ].join("\n");
    }

    function buildStartPrompt(project, settings) {
      const mode = settings?.contentMode === "builtin" ? "builtin" : "skill";
      const contentSkill = String(settings?.skills?.content || "").trim();
      const useSkill = mode === "skill" && !!contentSkill;
      const fallbackText = String(settings?.contentFallbackPrompt || "").trim() || DEFAULT_CONTENT_INSTRUCTION.join("\n");
      const startLines = useSkill
        ? DEFAULT_START_INSTRUCTION.replace(/page-content/g, contentSkill).split(/\r?\n/)
        : fallbackText.split(/\r?\n/);
      const note = mode === "skill" && !contentSkill
        ? ["注意：未填写内容技能，已使用内置提示词。"]
        : [];
      return [
        `项目目录：${project.path}`,
        "需求文件：content/brief.md，需求附件在 content/input/。",
        ...startLines,
        ...note,
        ...contentRequirement(settings),
      ].join("\n");
    }

    function diffLines(oldText, newText) {
      const a = String(oldText || "").split(/\r?\n/);
      const b = String(newText || "").split(/\r?\n/);
      if (a.length * b.length > 90000) {
        return [
          { type: "same", text: "文本较长，已跳过逐行 diff；请直接查看两侧原文。" },
          ...b.map((line) => ({ type: "add", text: line })),
        ];
      }
      const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
      for (let i = 1; i <= a.length; i += 1) {
        for (let j = 1; j <= b.length; j += 1) {
          dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
      const out = [];
      let i = a.length;
      let j = b.length;
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
          out.push({ type: "same", text: a[i - 1] }); i -= 1; j -= 1;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
          out.push({ type: "add", text: b[j - 1] }); j -= 1;
        } else {
          out.push({ type: "del", text: a[i - 1] }); i -= 1;
        }
      }
      return out.reverse();
    }

    function Workbench() {      const [projects, setProjects] = useState([]);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState("");
      const [view, setView] = useState({ type: "list" });
      const [newOpen, setNewOpen] = useState(false);
      const [toast, setToast] = useState("");
      const [settings, setSettings] = useState(DEFAULT_SETTINGS);
      const [capabilities, setCapabilities] = useState({ reference: null, imagegen: null });
      const [settingsOpen, setSettingsOpen] = useState(false);
      const toastTimer = useRef(null);

      const showToast = (text) => {
        setToast(text);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 3200);
      };

      const loadProjects = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
          const data = await requestJson("api/projects");
          setProjects(data.projects || []);
          setError("");
        } catch (cause) {
          setError(cause.message || String(cause));
        } finally {
          if (!silent) setLoading(false);
        }
      };

      const loadSettings = async () => {
        try {
          const data = await requestJson("api/settings");
          setSettings(data.settings || DEFAULT_SETTINGS);
          setCapabilities({
            reference: data.reference || null,
            libraries: data.libraries || [],
            activeId: data.activeId || null,
            imagegen: data.imagegen || null,
          });
        } catch {}
      };

      const saveSettings = async (next) => {
        const data = await requestJson("api/settings", { method: "POST", body: next });
        setSettings(data.settings || DEFAULT_SETTINGS);
        setCapabilities({
          reference: data.reference || null,
          libraries: data.libraries || [],
          activeId: data.activeId || null,
          imagegen: data.imagegen || null,
        });
        setSettingsOpen(false);
        if (data.restartRequired) {
          showToast("项目根目录已保存；重启 DSH 后生效");
        } else {
          await loadProjects(true);
          showToast("设置已保存");
        }
      };

      const openProject = async (id) => {
        try {
          const data = await requestJson(`api/projects/${encodeURIComponent(id)}`);
          setView({ type: "detail", project: data.project });
        } catch (cause) {
          showToast(cause.message || String(cause));
        }
      };

      const refreshDetail = async () => {
        if (view.type !== "detail") return;
        try {
          const data = await requestJson(`api/projects/${encodeURIComponent(view.project.id)}`);
          setView({ type: "detail", project: data.project });
        } catch (cause) {
          showToast(cause.message || String(cause));
        }
      };

      const createProject = async (payload, files) => {
        const created = await requestJson("api/projects", { method: "POST", body: payload });
        const project = created.project;
        for (const file of files) {
          await fetch(endpoint(`api/projects/${encodeURIComponent(project.id)}/inputs`), {
            method: "POST",
            headers: { "x-filename": encodeURIComponent(file.name) },
            body: file,
          }).then(async (response) => {
            if (!response.ok) {
              let message = `上传失败：${file.name}`;
              try { message = (await response.json()).error || message; } catch {}
              throw new Error(message);
            }
          });
        }
        let sessionError = "";
        try {
          await ensureSession(project);
          await sendToProject(project, buildStartPrompt(project, settings));
        } catch (cause) {
          sessionError = cause.message || String(cause);
        }
        setNewOpen(false);
        await loadProjects(true);
        setView({ type: "detail", project });
        showToast(sessionError ? `项目已创建；内容会话未启动：${sessionError}` : "项目已创建，已发送内容架构指令");
      };

      const deleteProject = async (project) => {
        if (!window.confirm(`确定删除项目“${project.title}”？\n会删除项目目录 ${project.path}，并清理对应的 DSH workspace/会话关联。`)) return;
        try {
          await requestJson(`api/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
          let cleanupError = "";
          if (project.contentSessionId && services.uiWorkspace && typeof services.uiWorkspace.archiveSession === "function") {
            try {
              await services.uiWorkspace.archiveSession(project.contentSessionId);
            } catch (cause) {
              cleanupError = cause.message || String(cause);
            }
          }
          if (project.workspaceId && services.workspaces && typeof services.workspaces.delete === "function") {
            try {
              await services.workspaces.delete(project.workspaceId);
            } catch (cause) {
              cleanupError = cause.message || String(cause);
            }
          }
          setView({ type: "list" });
          await loadProjects(true);
          showToast(cleanupError ? `项目已删除；DSH 关联清理失败：${cleanupError}` : "项目已删除");
        } catch (cause) {
          showToast(cause.message || String(cause));
        }
      };

      useEffect(() => {
        void loadProjects();
        void loadSettings();
        const timer = setInterval(() => { void loadProjects(true); }, 10000);
        return () => clearInterval(timer);
      }, []);

      const header = h("div", { style: S.top },
        h("div", { style: { flex: "1 1 auto", minWidth: 180 } },
          h("div", { style: S.h1 }, "方案工作台"),
          h("div", { style: S.muted }, "开发者：圣婴 | 微信：say007go | 版本号：0.1.50")
        ),
        h(Button, { onClick: () => setNewOpen(true), variant: "primary" }, "新建项目"),
        h(Button, { onClick: () => setSettingsOpen(true) }, "设置"),
        h(Button, { onClick: () => void loadProjects() }, "刷新")
      );

      if (view.type === "detail") {
        return h("div", { style: S.root },
          h(ProjectView, {
            project: view.project,
            settings,
            onBack: () => { setView({ type: "list" }); void loadProjects(true); },
            onRefresh: refreshDetail,
            onDelete: () => deleteProject(view.project),
            showToast,
          }),
          h(Toast, { text: toast })
        );
      }

      return h("div", { style: S.root },
        header,
        h("div", { style: S.body },
          error ? h("div", { style: { color: "#d9534f", marginBottom: 12 } }, error) : null,
          loading ? h(Empty, { text: "正在读取项目…" }) : projects.length === 0
            ? h("div", { style: { maxWidth: 620, margin: "40px auto", textAlign: "center" } },
                h("div", { style: { fontSize: 16, fontWeight: 600, marginBottom: 8 } }, "还没有项目"),
                h("div", { style: S.muted }, "新建一个项目，导入需求，然后打开项目专属内容对话。"),
                h("div", { style: { marginTop: 16 } }, h(Button, { variant: "primary", onClick: () => setNewOpen(true) }, "新建第一个项目"))
              )
            : h("div", { style: S.grid }, projects.map((project) => h(ProjectCard, {
                key: project.id,
                project,
                onOpen: () => openProject(project.id),
              }))
          )
        ),
        newOpen ? h(NewProjectModal, {
          onClose: () => setNewOpen(false),
          onCreate: createProject,
        }) : null,
        settingsOpen ? h(SettingsModal, {
          settings,
          reference: capabilities.reference,
          libraries: capabilities.libraries || [],
          activeId: capabilities.activeId || null,
          imagegen: capabilities.imagegen,
          onRefresh: loadSettings,
          onClose: () => setSettingsOpen(false),
          onSave: saveSettings,
        }) : null,
        h(Toast, { text: toast })
      );
    }

    function SettingsModal({ settings, reference, libraries, activeId, imagegen, onRefresh, onClose, onSave }) {
      const [activeTab, setActiveTab] = useState("prompts");
      const [projectsRoot, setProjectsRoot] = useState(settings?.projectsRoot || "");
      const [contentMode, setContentMode] = useState(settings?.contentMode === "builtin" ? "builtin" : "skill");
      const [skills, setSkills] = useState({ ...DEFAULT_SKILLS, ...(settings?.skills || {}) });
      const [contentPrompt, setContentPrompt] = useState(settings?.contentPrompt || "");
      const [contentFallbackPrompt, setContentFallbackPrompt] = useState(settings?.contentFallbackPrompt || DEFAULT_CONTENT_INSTRUCTION.join("\n"));
      const [renderPrompts, setRenderPrompts] = useState({ ...DEFAULT_RENDER_PROMPTS, ...(settings?.renderPrompts || {}) });
      const [renderTarget, setRenderTarget] = useState("pptx");
      const [renderPolicy, setRenderPolicy] = useState("default");
      const [referenceLive, setReferenceLive] = useState(reference);
      const [referenceLibraries, setReferenceLibraries] = useState(() => referenceLibraryList(reference, libraries));
      const [multiLibraryReady, setMultiLibraryReady] = useState(Array.isArray(libraries));
      const [activeReferenceId, setActiveReferenceId] = useState(activeId || null);
      const [newReferenceName, setNewReferenceName] = useState("");
      const [imagegenLive, setImagegenLive] = useState(imagegen);
      const [referenceBusy, setReferenceBusy] = useState(false);
      const [referenceProgress, setReferenceProgress] = useState(null);
      const [referenceCheck, setReferenceCheck] = useState(null);
      const [referenceError, setReferenceError] = useState("");
      const [contentSkillStatus, setContentSkillStatus] = useState(null);
      const [imagegenChecking, setImagegenChecking] = useState(false);
      const [copyHint, setCopyHint] = useState("");
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");
      const fileRef = useRef(null);
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const initialSnapshot = useMemo(() => JSON.stringify({
        projectsRoot: settings?.projectsRoot || "",
        contentMode: settings?.contentMode === "builtin" ? "builtin" : "skill",
        skills: { ...DEFAULT_SKILLS, ...(settings?.skills || {}) },
        contentPrompt: settings?.contentPrompt || "",
        contentFallbackPrompt: settings?.contentFallbackPrompt || DEFAULT_CONTENT_INSTRUCTION.join("\n"),
        renderPrompts: { ...DEFAULT_RENDER_PROMPTS, ...(settings?.renderPrompts || {}) },
      }), [settings]);
      const currentSnapshot = JSON.stringify({
        projectsRoot, contentMode, skills, contentPrompt, contentFallbackPrompt, renderPrompts,
      });
      const dirty = currentSnapshot !== initialSnapshot;
      const requestClose = () => {
        if (referenceBusy) return;
        if (dirty && !window.confirm("有未保存的设置修改，放弃修改？")) return;
        onClose();
      };
      const updatePrompt = (key, value) => setRenderPrompts((prev) => ({ ...prev, [key]: value }));
      const updateSkill = (key, value) => {
        setSkills((prev) => ({ ...prev, [key]: value }));
        setContentSkillStatus(null);
      };
      const referenceTargetDirty = projectsRoot !== (settings?.projectsRoot || "");
      const copyValue = async (text) => {
        try {
          await navigator.clipboard.writeText(text);
          setCopyHint("已复制");
          setTimeout(() => setCopyHint(""), 1500);
        } catch (cause) {
          setError(cause.message || String(cause));
        }
      };
      const pickRoot = async () => {
        try {
          const picked = await services.uiWorkspace?.pickDirectory?.();
          if (picked) setProjectsRoot(picked);
        } catch (cause) {
          setError(cause.message || String(cause));
        }
      };
      const applyReferenceState = (data) => {
        setReferenceLive(data.reference || null);
        setReferenceLibraries(referenceLibraryList(data.reference, data.libraries));
        setMultiLibraryReady(Array.isArray(data.libraries));
        setActiveReferenceId(data.activeId || null);
      };
      const refreshCapabilities = async () => {
        const data = await requestJson("api/settings");
        applyReferenceState(data);
        setImagegenLive(data.imagegen);
        try { await onRefresh?.(); } catch {}
        return data;
      };
      const pollReferenceJob = async (initial, activateId = "") => {
        let job = initial;
        while (job && job.status === "running") {
          setReferenceProgress(job);
          await wait(1200);
          const data = await requestJson("api/reference/job");
          job = data.job;
        }
        if (job) setReferenceProgress(job);
        if (!job || job.status !== "done") throw new Error(job?.error || "参考库构建失败");
        if (activateId) {
          const activated = await requestJson("api/reference/activate", { method: "POST", body: { id: activateId } });
          applyReferenceState(activated);
        }
        await refreshCapabilities();
        return job;
      };
      const uploadReference = async (file) => {
        if (!file) return;
        if (!multiLibraryReady) {
          setReferenceError("当前 DSH 宿主还没有加载多参考库接口，请重启 DSH。");
          if (fileRef.current) fileRef.current.value = "";
          return;
        }
        if (!/\.pptx$/i.test(file.name)) {
          setReferenceError("只支持 .pptx 参考文件");
          if (fileRef.current) fileRef.current.value = "";
          return;
        }
        if (referenceTargetDirty) {
          setReferenceError("参考库根目录有未保存修改，请先保存设置。");
          if (fileRef.current) fileRef.current.value = "";
          return;
        }
        const name = String(newReferenceName || "").trim() || file.name.replace(/\.pptx$/i, "");
        setReferenceBusy(true);
        setReferenceError("");
        setReferenceCheck(null);
        setReferenceProgress({ stage: "uploading", percent: 2, message: "上传参考文件" });
        try {
          const response = await fetch(endpoint("api/reference/upload"), {
            method: "POST",
            headers: { "x-filename": encodeURIComponent(file.name), "x-library-name": encodeURIComponent(name) },
            body: file,
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || `上传失败（${response.status}）`);
          setNewReferenceName("");
          await pollReferenceJob(data.job, data.library?.id || "");
        } catch (cause) {
          setReferenceError(cause.message || String(cause));
          setReferenceProgress(null);
          void refreshReference();
        } finally {
          setReferenceBusy(false);
          if (fileRef.current) fileRef.current.value = "";
        }
      };
      const rebuildReference = async (id = activeReferenceId) => {
        if (!id) return;
        setReferenceBusy(true);
        setReferenceError("");
        setReferenceCheck(null);
        setReferenceProgress({ stage: "starting", percent: 1, message: "准备重新构建" });
        try {
          const response = await fetch(endpoint("api/reference/rebuild"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || `重新构建失败（${response.status}）`);
          await pollReferenceJob(data.job);
        } catch (cause) {
          setReferenceError(cause.message || String(cause));
          setReferenceProgress(null);
          void refreshReference();
        } finally {
          setReferenceBusy(false);
        }
      };
      const refreshReference = async () => {
        try {
          const data = await requestJson("api/reference/status");
          applyReferenceState(data);
          setReferenceProgress(data.job);
        } catch (cause) {
          setReferenceError(cause.message || String(cause));
        }
      };
      const activateReference = async (id) => {
        if (!id || id === activeReferenceId) return;
        setReferenceBusy(true);
        setReferenceError("");
        try {
          const data = await requestJson("api/reference/activate", { method: "POST", body: { id } });
          applyReferenceState(data);
          setReferenceCheck(null);
        } catch (cause) {
          setReferenceError(cause.message || String(cause));
        } finally {
          setReferenceBusy(false);
        }
      };
      const renameReference = async (library) => {
        const name = window.prompt("参考库名称", library.name);
        if (name === null || !name.trim()) return;
        setReferenceBusy(true);
        setReferenceError("");
        try {
          const data = await requestJson(`api/reference/libraries/${encodeURIComponent(library.id)}`, { method: "PATCH", body: { name } });
          applyReferenceState(data);
        } catch (cause) {
          setReferenceError(cause.message || String(cause));
        } finally {
          setReferenceBusy(false);
        }
      };
      const deleteReference = async (library) => {
        if (!window.confirm(`删除参考库“${library.name}”？\n会删除目录 ${library.root}，且不可恢复。`)) return;
        setReferenceBusy(true);
        setReferenceError("");
        try {
          const data = await requestJson(`api/reference/libraries/${encodeURIComponent(library.id)}`, { method: "DELETE" });
          applyReferenceState(data);
          setReferenceCheck(null);
        } catch (cause) {
          setReferenceError(cause.message || String(cause));
        } finally {
          setReferenceBusy(false);
        }
      };
      const validateReference = async (id = activeReferenceId) => {
        if (!id) return;
        setReferenceBusy(true);
        setReferenceError("");
        setReferenceCheck(null);
        try {
          const data = await requestJson("api/reference/validate", { method: "POST", body: { id } });
          setReferenceCheck(data);
          await refreshReference();
        } catch (cause) {
          setReferenceError(cause.message || String(cause));
        } finally {
          setReferenceBusy(false);
        }
      };
      useEffect(() => {
        if (activeTab !== "reference") return;
        if (typeof window !== "undefined" && window.location.protocol === "file:") return;
        void refreshReference();
      }, [activeTab]);
      const checkContentSkill = async () => {
        const name = String(skills.content || "").trim();
        if (!name) {
          setContentSkillStatus({ checking: false, available: false, reason: "未填写内容技能" });
          return;
        }
        setContentSkillStatus({ checking: true });
        try {
          const data = await requestJson(`api/skills/available?name=${encodeURIComponent(name)}&cwd=${encodeURIComponent(projectsRoot || "")}`);
          setContentSkillStatus({ checking: false, available: data.available === true, reason: data.reason || "" });
        } catch (cause) {
          setContentSkillStatus({ checking: false, available: false, reason: cause.message || String(cause) });
        }
      };
      const checkImagegen = async () => {
        setImagegenChecking(true);
        setError("");
        try {
          const data = await requestJson("api/settings");
          setImagegenLive(data.imagegen);
          try { await onRefresh?.(); } catch {}
        } catch (cause) {
          setError(cause.message || String(cause));
        } finally {
          setImagegenChecking(false);
        }
      };
      const resetPrompts = () => {
        if (!window.confirm("把内容要求、内置内容提示词和页面取舍规则恢复到默认值？")) return;
        setContentPrompt(DEFAULT_CONTENT_PROMPT);
        setContentFallbackPrompt(DEFAULT_CONTENT_INSTRUCTION.join("\n"));
        setRenderPrompts({ ...DEFAULT_RENDER_PROMPTS });
      };
      const save = async () => {
        setBusy(true);
        setError("");
        try {
          await onSave({ projectsRoot, contentMode, skills, contentPrompt, contentFallbackPrompt, renderPrompts });
        } catch (cause) {
          setError(cause.message || String(cause));
        } finally {
          setBusy(false);
        }
      };
      const promptCard = {
        padding: "0 0 22px",
        marginBottom: 22,
        borderBottom: `1px solid ${BORDER}`,
        background: "transparent",
      };
      const moduleTitle = (title, style = {}) => h("div", {
        style: { ...TYPE.section, ...style },
      }, title);
      const sectionHeader = (title, right = null, hint = "") => h("div", { style: { marginBottom: 12 } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 } },
          moduleTitle(title),
          right
        ),
        hint ? h("div", { style: { ...TYPE.caption, color: FAINT, marginTop: 4 } }, hint) : null
      );
      const readonlyPrompt = {
        ...S.pre,
        ...TYPE.prompt,
        margin: 0,
        padding: 0,
        color: MUTED,
      };
      const promptInput = { ...S.input, ...TYPE.body, lineHeight: 1.8, resize: "vertical" };
      const promptDoc = {
        border: `1px solid ${SOFT_BORDER}`,
        borderRadius: 10,
        padding: 0,
        overflow: "hidden",
        background: "var(--dsw-alias-bg-base, rgba(128,128,128,.035))",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.035), 0 1px 2px rgba(0,0,0,.05)",
        ...TYPE.prompt,
      };
      const promptDocHead = {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "9px 14px",
        borderBottom: `1px solid ${BORDER}`,
        background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,.035))",
      };
      const promptDocBody = { padding: "13px 15px 15px" };
      const readonlyDoc = { ...promptDoc };
      const readonlyDocHead = { ...promptDocHead };
      const readonlyDocBody = { padding: "12px 15px 13px" };
      const promptDocChip = {
        display: "inline-flex",
        alignItems: "center",
        border: `1px solid ${SOFT_BORDER}`,
        borderRadius: 999,
        padding: "2px 7px",
        color: FAINT,
        ...TYPE.meta,
      };
      const promptDocChipEditable = {
        ...promptDocChip,
        color: ACCENT,
        borderColor: `${ACCENT}55`,
        background: `${ACCENT}0f`,
      };
      const segmented = {
        display: "inline-flex",
        gap: 2,
        padding: 3,
        border: `1px solid ${SOFT_BORDER}`,
        borderRadius: 8,
        background: "var(--dsw-alias-bg-base, rgba(128,128,128,.035))",
      };
      const segment = {
        appearance: "none",
        border: "1px solid transparent",
        borderRadius: 6,
        padding: "6px 12px",
        background: "transparent",
        color: MUTED,
        fontFamily: "inherit",
        cursor: "pointer",
        ...TYPE.control,
      };
      const segmentActive = {
        ...segment,
        border: `1px solid ${SOFT_BORDER}`,
        background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,.16))",
        color: TEXT,
        fontWeight: 600,
        boxShadow: "0 1px 2px rgba(0,0,0,.22)",
      };
      const renderSegmented = (options, value, onChange, ariaLabel) => h("div", {
        style: segmented,
        role: "group",
        "aria-label": ariaLabel,
      }, options.map(([key, label]) => h("button", {
        key,
        type: "button",
        style: value === key ? segmentActive : segment,
        "aria-pressed": value === key,
        onClick: () => onChange(key),
      }, label)));

      const promptFixedLine = { ...TYPE.prompt, color: MUTED };
      const inlineSkillInput = {
        ...S.input,
        display: "inline-block",
        width: 112,
        minWidth: 88,
        maxWidth: "60%",
        padding: "2px 6px",
        margin: "0 2px",
        border: `1px solid ${SOFT_BORDER}`,
        borderBottomColor: `${ACCENT}88`,
        borderRadius: 5,
        background: "var(--dsw-alias-bg-base, rgba(128,128,128,.06))",
        fontFamily: "inherit",
        ...TYPE.body,
        lineHeight: 1.5,
        verticalAlign: "baseline",
      };
      const examples = {
        pptx: { file: "renders/pptx/P02.pptx", skill: "ppt-layout", note: DEFAULT_TARGET_NOTES.pptx },
        image: { file: "renders/image/P02.png", skill: "image-layout", note: DEFAULT_TARGET_NOTES.image },
        html: { file: "renders/html/P02.html", skill: "html-layout", note: DEFAULT_TARGET_NOTES.html },
      };
      const example = examples[renderTarget];
      const settingsTabs = [
        { id: "prompts", label: "提示词设置", hint: "内容、版式与生成规则", icon: "sliders" },
        { id: "reference", label: "参考库", hint: "页面参考与检索库", icon: "library" },
        { id: "advanced", label: "其他设置", hint: "路径、能力与诊断", icon: "settings" },
      ];
      const activeMeta = settingsTabs.find((item) => item.id === activeTab) || settingsTabs[0];
      const contentSkillName = String(skills.content || "").trim();
      const contentSkillParts = DEFAULT_START_INSTRUCTION.split("page-content");
      const contentSkillPrefix = contentSkillParts[0] || "";
      const contentSkillSuffix = contentSkillParts.slice(1).join("page-content");
      const useSkillPrompt = contentMode === "skill" && !!contentSkillName;
      const contentSkillText = !contentSkillName
        ? "未填写内容技能；当前实际发送使用内置提示词。"
        : contentSkillStatus?.checking
          ? "检测中…"
          : contentSkillStatus?.available === true
            ? "内容技能可用。"
            : contentSkillStatus?.available === false
              ? `未检测到该技能；仍会按你的选择发送带技能提示词，可能失败${contentSkillStatus.reason ? `（${contentSkillStatus.reason}）` : ""}。`
              : "尚未检测；可点击检测确认技能是否可用。";
      const contentTab = [
        h("div", { style: promptCard },
          moduleTitle("内容生成", { marginBottom: 6 }),
          h("div", { style: { ...TYPE.caption, color: FAINT, marginBottom: 10 } },
            "新建项目或空白页首次打开时发送。下面这块就是实际发送内容；项目目录在运行时自动填入。"
          ),
          h("div", { style: { marginBottom: 10 } },
            renderSegmented([["skill", "调用内容技能"], ["builtin", "不调用内容技能"]], contentMode, setContentMode, "内容生成方式")
          ),
          contentMode === "skill" ? h("div", { style: { ...S.row, flexWrap: "wrap", gap: 8, marginBottom: 10 } },
            h(Button, { variant: "ghost", onClick: () => void checkContentSkill(), disabled: contentSkillStatus?.checking }, contentSkillStatus?.checking ? "检测中…" : "检测技能"),
            h("span", { style: { ...TYPE.caption, color: contentSkillStatus?.available === false ? "#d9534f" : FAINT } }, contentSkillText)
          ) : null,
          h("div", { style: promptDoc },
            h("div", { style: promptDocHead },
              h("div", { style: { ...TYPE.meta, color: FAINT, letterSpacing: ".02em" } }, "实际发送内容"),
              h("div", { style: { display: "flex", gap: 5 } },
                h("span", { style: promptDocChip }, "固定规则"),
                h("span", { style: promptDocChipEditable }, "可编辑")
              )
            ),
            h("div", { style: promptDocBody },
            h("div", { style: promptFixedLine }, "项目目录：<项目根>"),
            h("div", { style: promptFixedLine }, "需求文件：content/brief.md，需求附件在 content/input/。"),
            contentMode === "skill" ? h("div", { style: { marginTop: 8 } },
              h("div", { style: { ...TYPE.prompt, color: MUTED } },
                contentSkillPrefix,
                h("input", {
                  style: inlineSkillInput,
                  value: skills.content || "",
                  onChange: (event) => updateSkill("content", event.target.value),
                  placeholder: "技能名",
                  title: "点击修改内容技能",
                  "aria-label": "内容技能",
                }),
                contentSkillSuffix
              )
            ) : null,
            !useSkillPrompt ? h("div", { style: { marginTop: 10 } },
              h("div", { style: { ...S.row, justifyContent: "space-between", marginBottom: 6 } },
                h("div", { style: S.label }, contentMode === "skill" ? "内置提示词（当前实际发送）" : "内置提示词"),
                h(Button, { variant: "ghost", onClick: () => setContentFallbackPrompt(DEFAULT_CONTENT_INSTRUCTION.join("\n")) }, "恢复默认")
              ),
              h("textarea", {
                style: { ...promptInput, minHeight: 120, background: "var(--dsw-alias-bg-base, rgba(128,128,128,.04))" },
                value: contentFallbackPrompt,
                placeholder: DEFAULT_CONTENT_INSTRUCTION.join("\n"),
                onChange: (event) => setContentFallbackPrompt(event.target.value),
              }),
              contentMode === "skill" && !contentSkillName ? h("div", { style: { ...promptFixedLine, marginTop: 6, color: "#d9534f" } },
                "注意：未填写内容技能，已使用内置提示词。"
              ) : null
            ) : null,
            h("div", { style: { marginTop: 12, paddingTop: 10, borderTop: `1px solid ${BORDER}` } },
              h("div", { style: { ...S.row, justifyContent: "space-between", marginBottom: 6 } },
                h("div", { style: { display: "flex", alignItems: "baseline", gap: 6 } },
                  h("div", { style: S.label }, "内容要求："),
                  h("span", { style: { ...TYPE.meta, color: FAINT } }, "两类共用")
                ),
                h(Button, { variant: "ghost", onClick: () => setContentPrompt(DEFAULT_CONTENT_PROMPT) }, "恢复默认")
              ),
              h("textarea", {
                style: { ...promptInput, minHeight: 75, background: "var(--dsw-alias-bg-base, rgba(128,128,128,.04))" },
                value: contentPrompt,
                placeholder: "留空则不发送内容要求段落",
                onChange: (event) => setContentPrompt(event.target.value),
              })
            )
          )
          )
        ),
        h("div", { style: promptCard },
          moduleTitle("优化此页", { marginBottom: 8 }),
          h("div", { style: readonlyDoc },
            h("div", { style: readonlyDocHead },
              h("div", { style: { ...TYPE.meta, color: FAINT, letterSpacing: ".02em" } }, "实际发送内容"),
              h("span", { style: promptDocChip }, "只读")
            ),
            h("div", { style: readonlyDocBody },
              h("div", { style: readonlyPrompt }, `项目目录：<项目根>/project-example
页面：P02 页面标题
当前文案：content/pages/P02.md
${DEFAULT_OPTIMIZE_INSTRUCTION}
反馈：`)
            )
          ),
          h("div", { style: { ...TYPE.caption, color: FAINT, marginTop: 8 } }, "反馈每次在“优化此页”弹窗里填写，不设预设提示词。")
        ),
        h("div", { style: promptCard },
          moduleTitle("生成页面", { marginBottom: 8 }),
          h("div", { style: { marginBottom: 8 } },
            renderSegmented(TARGET_ORDER.map((key) => [key, TARGET_LABELS[key]]), renderTarget, setRenderTarget, "目标格式")
          ),
          h("div", { style: { marginBottom: 10 } },
            renderSegmented([["default", "默认"], ["preserve", "完全保留文案"], ["compress", "允许版式压缩"]], renderPolicy, setRenderPolicy, "版式取舍规则")
          ),
          h("div", { style: readonlyDoc },
            h("div", { style: readonlyDocHead },
              h("div", { style: { ...TYPE.meta, color: FAINT, letterSpacing: ".02em" } }, "实际发送内容"),
              h("span", { style: promptDocChip }, "只读")
            ),
            h("div", { style: readonlyDocBody },
              h("div", { style: readonlyPrompt }, `项目目录：<项目根>/project-example
页面：P02 页面标题
源文案：content/pages/P02.md
产物路径：${example.file}
请使用 ${example.skill} 为这一页制作页面。${example.note}`)
            )
          ),
          h("div", { style: { ...S.row, justifyContent: "space-between", marginTop: 10, marginBottom: 4 } },
            h("div", { style: S.label }, "版式取舍规则（可编辑）"),
            h(Button, { variant: "ghost", onClick: () => updatePrompt(renderPolicy, DEFAULT_RENDER_PROMPTS[renderPolicy]) }, "恢复默认")
          ),
          h("textarea", {
            style: { ...promptInput, minHeight: 70 },
            value: renderPrompts[renderPolicy] || DEFAULT_RENDER_PROMPTS[renderPolicy],
            onChange: (event) => updatePrompt(renderPolicy, event.target.value),
          }),
          h("div", { style: { ...readonlyPrompt, marginTop: 10 } }, "不要回写 content/pages 下的源文案。"),
          h("div", { style: { ...TYPE.caption, color: FAINT, marginTop: 8 } },
            "生成弹窗里填写“本页临时备注”时，它会替换上面的取舍规则；不填写就使用当前选中的规则。",
            h("br"),
            "最后一行“不要回写源文案”是固定要求，不能编辑。"
          )
        ),
      ];
      const librarySummary = referenceLibraries.length
        ? `共 ${referenceLibraries.length} 个库`
        : "未配置参考库";
      const referenceErrors = referenceCheck?.report?.errors || [];
      const referenceCheckBox = (library) => referenceCheck?.reference?.id === library.id ? h("div", {
        style: {
          marginTop: 2,
          padding: "8px 10px",
          borderRadius: 8,
          border: `1px solid ${referenceCheck.ok ? "#2f8f5b" : "#d9534f"}55`,
          color: referenceCheck.ok ? "#2f8f5b" : "#d9534f",
          ...TYPE.caption,
        },
      },
        h("div", null, referenceCheck.ok ? "校验通过：参考库结构、索引和页面图一致。" : `校验未通过：${referenceErrors.length} 项问题。`),
        !referenceCheck.ok && referenceErrors.length
          ? h("div", { style: { marginTop: 4 } }, `${referenceErrors.slice(0, 5).join("；")}${referenceErrors.length > 5 ? "；…" : ""}`)
          : null
      ) : null;
      const referenceRow = (library) => h("div", {
        key: library.id,
        style: {
          border: `1px solid ${library.active ? `${ACCENT}66` : SOFT_BORDER}`,
          background: library.active ? "var(--dsw-alias-bg-layer-2, rgba(128,128,128,.07))" : "transparent",
          borderRadius: 10,
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        },
      },
        h("div", { style: { ...S.row, justifyContent: "space-between", alignItems: "flex-start" } },
          h("div", { style: { minWidth: 0 } },
            h("div", { style: { display: "flex", alignItems: "center", gap: 6, minWidth: 0 } },
              h("span", { style: { ...S.dot, background: library.ok ? "#2f8f5b" : "#d9534f", flex: "0 0 auto" } }),
              h("span", { style: { ...TYPE.item, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, library.name),
              library.active ? h("span", { style: { ...S.badge, color: ACCENT, borderColor: `${ACCENT}44`, background: `${ACCENT}0d`, fontSize: 10 } }, "当前使用") : null
            ),
            h("div", { style: { ...TYPE.caption, color: MUTED, marginTop: 3 } },
              `${library.ok ? `${library.pages} 页` : "不可用"}${library.builtAt ? ` · ${new Date(library.builtAt).toLocaleString("zh-CN", { hour12: false })}` : ""}`
            ),
            h("div", { style: { ...TYPE.meta, color: FAINT, marginTop: 2, fontFamily: MONO, wordBreak: "break-all" } }, library.root)
          ),
          multiLibraryReady ? h("div", { style: { ...S.row, flexWrap: "wrap", justifyContent: "flex-end" } },
            !library.active ? h(Button, { variant: "ghost", onClick: () => void activateReference(library.id), disabled: referenceBusy || !library.ok || referenceTargetDirty }, "切换") : null,
            h(Button, { variant: "ghost", onClick: () => void rebuildReference(library.id), disabled: referenceBusy || referenceTargetDirty }, "重新构建"),
            h(Button, { variant: "ghost", onClick: () => void validateReference(library.id), disabled: referenceBusy || referenceTargetDirty }, "校验"),
            h(Button, { variant: "ghost", onClick: () => void renameReference(library), disabled: referenceBusy }, "重命名"),
            !library.active ? h(Button, { variant: "ghost", onClick: () => void deleteReference(library), disabled: referenceBusy, style: { color: "#d9534f" } }, "删除") : null
          ) : null
        ),
        referenceCheckBox(library)
      );
      const referenceTab = [
        h("div", { style: { ...TYPE.caption, color: FAINT, marginBottom: 14 } },
          "参考库是共享的页面参考集，同一时间只有一个当前库。新建库不会覆盖已有库；切换只影响之后运行的排版技能。"
        ),
        h("div", { style: promptCard },
          sectionHeader("当前参考库", h("div", { style: { ...TYPE.caption, color: FAINT } }, librarySummary)),
          referenceTargetDirty ? h("div", { style: { ...TYPE.caption, marginBottom: 10, color: "#d9534f" } },
            "项目根目录有未保存修改；先在“其他设置”保存，再上传、切换或重建。"
          ) : null,
          h("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
            referenceLibraries.length
              ? referenceLibraries.map(referenceRow)
              : h(Empty, { text: multiLibraryReady ? "还没有参考库。在下面新建第一个库。" : "当前 DSH 宿主还没有加载多参考库接口。" })
          ),
        ),
        multiLibraryReady ? h("div", {
          style: { ...promptCard, border: `1px dashed ${SOFT_BORDER}`, borderRadius: 10, padding: 14, marginBottom: 0 },
        },
          sectionHeader("新建参考库", h("div", { style: { ...TYPE.caption, color: FAINT } }, referenceLibraries.length ? "" : "第一个库构建成功后会自动设为当前库")),
          h("div", { style: { ...S.row, alignItems: "stretch", marginBottom: 8 } },
            h("input", {
              style: { ...S.input, flex: "1 1 240px" },
              value: newReferenceName,
              onChange: (event) => setNewReferenceName(event.target.value),
              placeholder: "参考库名称，例如：方案排版参考",
            }),
            h("input", {
              ref: fileRef,
              type: "file",
              accept: ".pptx",
              style: { display: "none" },
              onChange: (event) => void uploadReference(event.target.files?.[0]),
            }),
            h(Button, { variant: "primary", onClick: () => fileRef.current?.click(), disabled: referenceBusy || referenceTargetDirty }, referenceBusy ? "构建中…" : "选择 PPTX 并构建")
          ),
          h("div", { style: { ...TYPE.caption, color: FAINT } },
            "支持 .pptx。构建需要 LibreOffice 和 Python，通常需要几分钟；构建期间不要关闭设置。"
          ),
        ) : null,
        referenceProgress ? h("div", { style: promptCard },
          h("div", { style: { ...S.row, justifyContent: "space-between", marginBottom: 8 } },
            h("div", { style: TYPE.section }, "构建进度"),
            h("div", { style: { ...TYPE.caption, color: FAINT } }, `${referenceProgress.stage || "构建"} · ${referenceProgress.percent || 0}%`)
          ),
          h("div", { style: { height: 6, borderRadius: 3, background: BORDER, overflow: "hidden", marginBottom: 8 } },
            h("div", { style: { height: "100%", width: `${Math.max(0, Math.min(100, Number(referenceProgress.percent) || 0))}%`, background: ACCENT } })
          ),
          h("div", { style: { ...TYPE.caption, color: FAINT } }, referenceProgress.message || ""),
          referenceProgress.status === "error" ? h("div", { style: { ...TYPE.caption, color: "#d9534f", marginTop: 6 } }, referenceProgress.error || "构建失败") : null
        ) : null,
        referenceError ? h("div", { style: { ...TYPE.body, color: "#d9534f", marginBottom: 12 } }, referenceError) : null,
        !multiLibraryReady ? h("div", { style: { ...TYPE.caption, color: "#d9534f" } },
          "当前 DSH 宿主还没有加载多参考库接口，请重启 DSH 后再管理库列表。"
        ) : null,
      ];
      const imagegenText = !imagegenLive
        ? "生图能力尚未检测。"
        : imagegenLive.available === true
          ? `检测到 image_generate：${imagegenLive.detail || "可用"}。生成时直接调用。`
          : imagegenLive.available === false
            ? `未检测到 image_generate：${imagegenLive.detail || "不可用"}。图片按钮仍可点击，生成阶段会正常报错。`
            : `无法检测生图能力：${imagegenLive.detail || "未知"}。生成时按实际工具结果处理。`;
      const advancedContent = [
        h("div", { style: promptCard },
          sectionHeader("项目根目录", null,
            "只影响新建项目；已有项目不会迁移。保存后需要重启 DSH，工作台才会按新根目录扫描。"),
          h(Field, { label: "项目根目录路径", style: { marginBottom: 0 } },
            h("div", { style: { ...S.row, alignItems: "stretch" } },
              h("input", {
                style: { ...S.input, flex: "1 1 auto" },
                value: projectsRoot,
                onChange: (event) => setProjectsRoot(event.target.value),
                placeholder: "<项目根绝对路径>",
              }),
              h(Button, { onClick: () => void pickRoot() }, "选择目录"),
              h(Button, { variant: "ghost", onClick: () => void copyValue(projectsRoot) }, "复制")
            )
          ),
          h("div", { style: { ...TYPE.caption, color: FAINT, marginTop: 8 } },
            "保存后重启 DSH 生效；只影响新建项目和新建参考库，已有项目/参考库不会迁移。"
          )
        ),
        h("div", { style: promptCard },
          sectionHeader("图片生成能力",
            h(Button, { variant: "ghost", onClick: () => void checkImagegen(), disabled: imagegenChecking }, imagegenChecking ? "检测中…" : "重新检测"),
            "检测只做提示，不阻止图片按钮。生成时实际调用；工具缺失会正常报错。"),
          h("div", { style: { ...TYPE.caption, color: imagegenLive?.available === false ? "#d9534f" : FAINT } }, imagegenText)
        ),
        h("div", { style: promptCard },
          sectionHeader("诊断与重置", null,
            "当前插件 v0.1.50。参考库状态和内容技能状态会随保存刷新。"),
          h("div", { style: { ...S.row, flexWrap: "wrap" } },
            h(Button, { variant: "ghost", onClick: () => void refreshCapabilities() }, "刷新能力状态"),
            h(Button, { variant: "ghost", onClick: resetPrompts }, "恢复默认提示词")
          )
        ),
      ];
      const SS = {
        shell: {
          width: "min(1120px, calc(100vw - 48px))",
          height: "min(740px, calc(100vh - 48px))",
          minHeight: 520,
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: SURFACE,
          color: TEXT,
          border: `1px solid ${BORDER}`,
          borderRadius: 14,
          backgroundImage: "radial-gradient(120% 90% at 88% -12%, rgba(173,1,1,.055), transparent 58%)",
          boxShadow: "0 28px 80px rgba(0,0,0,.42)",
        },
        body: { flex: "1 1 auto", minHeight: 0, display: "grid", gridTemplateColumns: "216px minmax(0, 1fr)" },
        rail: {
          minHeight: 0,
          background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,.055))",
          borderRight: `1px solid ${BORDER}`,
          padding: "20px 12px 16px",
          display: "flex",
          flexDirection: "column",
        },
        brand: { padding: "2px 10px 22px" },
        brandEyebrow: { ...TYPE.meta, letterSpacing: ".16em", color: FAINT, textTransform: "uppercase" },
        brandTitle: { margin: "7px 0 0", ...TYPE.brand },
        railLabel: { padding: "0 10px 8px", ...TYPE.meta, color: FAINT, letterSpacing: ".12em" },
        nav: { display: "flex", flexDirection: "column", gap: 3 },
        navItem: {
          position: "relative",
          width: "100%",
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "10px 10px",
          border: "1px solid transparent",
          borderRadius: 8,
          background: "transparent",
          color: MUTED,
          textAlign: "left",
          fontFamily: "inherit",
          cursor: "pointer",
        },
        navItemActive: {
          position: "relative",
          width: "100%",
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          padding: "10px 10px",
          border: `1px solid ${SOFT_BORDER}`,
          borderRadius: 8,
          background: "var(--dsw-alias-bg-layer-1, rgba(128,128,128,.08))",
          boxShadow: "0 1px 2px rgba(0,0,0,.08)",
          color: TEXT,
          textAlign: "left",
          fontFamily: "inherit",
          cursor: "pointer",
        },
        navIcon: {
          width: 24,
          height: 24,
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 7,
          border: "1px solid transparent",
          color: FAINT,
          fontSize: 12,
          lineHeight: 1,
        },
        navIconActive: {
          color: ACCENT,
          borderColor: `${ACCENT}33`,
          background: `${ACCENT}0d`,
        },
        navTitle: { display: "block", fontSize: 12.5, lineHeight: 1.5, fontWeight: 550 },
        navHint: { display: "block", marginTop: 2, ...TYPE.caption, color: FAINT },
        railFoot: { marginTop: "auto", padding: "12px 10px 0", borderTop: `1px solid ${BORDER}`, ...TYPE.caption, color: FAINT },
        main: { minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" },
        top: { flex: "0 0 auto", padding: "22px 28px 0", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, background: SURFACE, position: "relative", zIndex: 2 },
        crumb: { ...TYPE.meta, color: FAINT, letterSpacing: ".12em", textTransform: "uppercase" },
        pageTitle: { margin: "7px 0 0", ...TYPE.display },
        pageSub: { margin: "6px 0 0", ...TYPE.caption, color: FAINT, fontSize: 11 },
        close: { appearance: "none", border: 0, background: "transparent", color: MUTED, fontSize: 20, lineHeight: 1, padding: 3, cursor: "pointer", fontFamily: "inherit" },
        content: { flex: "1 1 auto", minHeight: 0, overflow: "auto", scrollbarGutter: "stable", padding: "20px 28px 20px" },
        error: { margin: "0 28px 10px", padding: "8px 10px", border: "1px solid rgba(217,83,79,.35)", borderRadius: 7, background: "rgba(217,83,79,.08)", color: "#d9534f", ...TYPE.caption },
        footer: { flex: "0 0 56px", borderTop: `1px solid ${BORDER}`, background: "var(--dsw-alias-bg-layer-2, rgba(128,128,128,.035))", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "0 18px 0 20px" },
        footerLeft: { display: "flex", alignItems: "center", gap: 6, minWidth: 0, ...TYPE.caption, color: FAINT },
        footerDot: { width: 5, height: 5, borderRadius: 999, flex: "0 0 auto", background: "currentColor" },
        footerActions: { display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" },
      };
      const footerStatus = error || copyHint || (busy ? "保存中…" : dirty ? "有未保存更改" : "所有更改已保存");
      const footerTone = error ? "#d9534f" : dirty ? ACCENT : "#2f8f5b";
      const activeContent = activeTab === "prompts" ? contentTab : activeTab === "reference" ? referenceTab : advancedContent;
      return h("div", { style: S.overlay, onMouseDown: (event) => { if (event.target === event.currentTarget) requestClose(); } },
        h("div", { style: SS.shell },
          h("div", { style: SS.body },
            h("aside", { style: SS.rail },
              h("div", { style: SS.brand },
                h("div", { style: SS.brandEyebrow }, "Deck Workbench"),
                h("div", { style: SS.brandTitle }, "工作台设置")
              ),
              h("div", { style: SS.railLabel }, "SETTINGS"),
              h("div", { style: SS.nav },
                settingsTabs.map((tab) => h("button", {
                  key: tab.id,
                  type: "button",
                  style: activeTab === tab.id ? SS.navItemActive : SS.navItem,
                  onClick: () => setActiveTab(tab.id),
                },
                  h("span", { style: { ...SS.navIcon, ...(activeTab === tab.id ? SS.navIconActive : {}) } }, h(SettingsIcon, { name: tab.icon, size: 14 })),
                  h("span", null,
                    h("span", { style: SS.navTitle }, tab.label),
                    h("span", { style: SS.navHint }, tab.hint)
                  )
                ))
              ),
              h("div", { style: SS.railFoot }, "设置只影响新任务", h("br"), "已有项目不会自动迁移")
            ),
            h("main", { style: SS.main },
              h("header", { style: SS.top },
                h("div", null,
                  h("div", { style: SS.crumb }, "工作台设置 / ", activeMeta.label),
                  h("div", { style: SS.pageTitle }, activeMeta.label),
                  h("div", { style: SS.pageSub }, activeMeta.hint)
                ),
                h("button", { type: "button", style: SS.close, onClick: requestClose, disabled: busy || referenceBusy, "aria-label": "关闭" }, "×")
              ),
              error ? h("div", { style: SS.error }, error) : null,
              h("div", { style: SS.content }, activeContent)
            )
          ),
          h("footer", { style: SS.footer },
            h("div", { style: { ...SS.footerLeft, color: footerTone } },
              h("span", { style: SS.footerDot }),
              h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, footerStatus)
            ),
            h("div", { style: SS.footerActions },
              h(Button, { variant: "ghost", onClick: requestClose, disabled: busy || referenceBusy }, "取消"),
              h(Button, { variant: "primary", onClick: () => void save(), disabled: busy || referenceBusy || !dirty }, busy ? "保存中…" : "保存")
            )
          )
        )
      );
    }

    function NewProjectModal({ onClose, onCreate }) {
      const [title, setTitle] = useState("");
      const [client, setClient] = useState("");
      const [brief, setBrief] = useState("");
      const [files, setFiles] = useState([]);
      const [targets, setTargets] = useState({ pptx: true, image: false, html: false });
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState("");

      const submit = async () => {
        if (!title.trim()) { setError("请填写项目名"); return; }
        setBusy(true);
        setError("");
        try {
          await onCreate({
            title: title.trim(),
            client: client.trim(),
            brief,
            targets: Object.entries(targets).filter(([, value]) => value).map(([key]) => key),
          }, files);
        } catch (cause) {
          setError(cause.message || String(cause));
        } finally {
          setBusy(false);
        }
      };

      return h("div", { style: S.overlay, onMouseDown: (event) => { if (event.target === event.currentTarget) onClose(); } },
        h("div", { style: S.modal },
          h("div", { style: { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 16 } },
            h("div", { style: S.h1 }, "新建项目"),
            h(Button, { variant: "ghost", onClick: onClose }, "关闭")
          ),
          h(Field, { label: "项目名" }, h("input", { style: S.input, value: title, onChange: (event) => setTitle(event.target.value), placeholder: "例如：江铃领军人才培育" })),
          h(Field, { label: "客户" }, h("input", { style: S.input, value: client, onChange: (event) => setClient(event.target.value), placeholder: "例如：江铃集团" })),
          h(Field, { label: "需求正文" }, h("textarea", { style: { ...S.input, minHeight: 120, resize: "vertical" }, value: brief, onChange: (event) => setBrief(event.target.value), placeholder: "粘贴需求、背景、目标、约束……" })),
          h(Field, { label: "需求附件（docx / pdf / txt / md / pptx）" }, h("input", { type: "file", multiple: true, onChange: (event) => setFiles(Array.from(event.target.files || [])) })),
          h("div", { style: { ...S.row, marginBottom: 16 } },
            h("span", { style: S.label }, "目标格式："),
            TARGET_ORDER.map((target) => h("label", { key: target, style: { display: "inline-flex", gap: 5, alignItems: "center", fontSize: 12 } },
              h("input", { type: "checkbox", checked: !!targets[target], onChange: (event) => setTargets((prev) => ({ ...prev, [target]: event.target.checked })) }),
              TARGET_LABELS[target]
            ))
          ),
          error ? h("div", { style: { color: "#d9534f", fontSize: 12, marginBottom: 10 } }, error) : null,
          h("div", { style: { ...S.row, justifyContent: "flex-end" } },
            h(Button, { variant: "ghost", onClick: onClose, disabled: busy }, "取消"),
            h(Button, { variant: "primary", onClick: () => void submit(), disabled: busy }, busy ? "创建中…" : "创建并打开内容对话")
          )
        )
      );
    }

    function GenerateModal({ page, target, onClose, onGenerate }) {
      const [policy, setPolicy] = useState("default");
      const [note, setNote] = useState("");
      const targetLabel = target === "html" ? "HTML" : target === "image" ? "图片" : "PPTX";
      const options = [
        ["default", "默认"],
        ["preserve", "完全保留文案"],
        ["compress", "允许版式压缩"],
      ];
      const choose = (key) => {
        setPolicy(key);
        setNote("");
      };
      return h("div", { style: S.overlay, onMouseDown: (event) => { if (event.target === event.currentTarget) onClose(); } },
        h("div", { style: S.modal },
          h("div", { style: { ...S.row, justifyContent: "space-between", marginBottom: 12 } },
            h("div", { style: S.h1 }, `生成 ${targetLabel}`),
            h(Button, { variant: "ghost", onClick: onClose }, "关闭")
          ),
          h("div", { style: { ...S.muted, marginBottom: 12 } }, `页面：${page.id} ${page.title}`),
          h("div", { style: { ...S.row, flexWrap: "wrap", marginBottom: 12 } },
            options.map(([key, label]) => h(Button, {
              key,
              variant: policy === key ? "primary" : "ghost",
              onClick: () => choose(key),
            }, label))
          ),
          h("div", { style: { ...S.muted, marginBottom: 6, fontSize: 12 } },
            "快捷项会整段替换本页的取舍规则；填写自定义要求时，会替换快捷项规则。"
          ),
          h("textarea", {
            style: { ...S.input, minHeight: 100, resize: "vertical" },
            value: note,
            onChange: (event) => {
              const value = event.target.value;
              setNote(value);
              setPolicy(value.trim() ? "custom" : "default");
            },
            placeholder: "自定义要求（可选）：例如本页标题必须用原文；允许压缩但保留所有数字……",
          }),
          h("div", { style: { ...S.row, justifyContent: "flex-end", marginTop: 12 } },
            h(Button, { variant: "ghost", onClick: onClose }, "取消"),
            h(Button, { variant: "primary", onClick: () => void onGenerate(policy, note) }, "生成")
          )
        )
      );
    }

    function ProjectView({ project: initial, settings, onBack, onRefresh, onDelete, showToast }) {
      const [project, setProject] = useState(initial);
      const [pageId, setPageId] = useState(initial.pages?.[0]?.id || null);
      const [page, setPage] = useState(null);
      const [tab, setTab] = useState("pptx");
      const [busy, setBusy] = useState(false);
      const [historyOpen, setHistoryOpen] = useState(false);
      const [optimizeOpen, setOptimizeOpen] = useState(false);
      const [generateTarget, setGenerateTarget] = useState(null);
      const splitRef = useRef(null);
      const dragRef = useRef(null);
      const [split, setSplit] = useState({ left: 170, middle: 320 });

      const startResize = (side, event) => {
        event.preventDefault();
        const width = splitRef.current?.clientWidth || 900;
        dragRef.current = { side, startX: event.clientX, left: split.left, middle: split.middle, width };
        const onMove = (moveEvent) => {
          const drag = dragRef.current;
          if (!drag) return;
          const dx = moveEvent.clientX - drag.startX;
          const minLeft = 140;
          const minMiddle = 220;
          const minRight = 280;
          const handle = 12;
          if (drag.side === "left") {
            const max = Math.max(minLeft, drag.width - drag.middle - minRight - handle);
            setSplit((prev) => ({ ...prev, left: Math.min(max, Math.max(minLeft, drag.left + dx)) }));
          } else {
            const max = Math.max(minMiddle, drag.width - drag.left - minRight - handle);
            setSplit((prev) => ({ ...prev, middle: Math.min(max, Math.max(minMiddle, drag.middle + dx)) }));
          }
        };
        const onUp = () => {
          dragRef.current = null;
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      };

      const loadPage = async (id, silent = false) => {
        if (!id) { setPage(null); return; }
        if (!silent) setBusy(true);
        try {
          const data = await requestJson(`api/projects/${encodeURIComponent(project.id)}/pages/${encodeURIComponent(id)}`);
          setPage(data.page);
        } catch (cause) {
          showToast(cause.message || String(cause));
        } finally {
          if (!silent) setBusy(false);
        }
      };

      const refresh = async () => {
        try {
          const data = await requestJson(`api/projects/${encodeURIComponent(project.id)}`);
          setProject(data.project);
          if (pageId && data.project.pages?.some((item) => item.id === pageId)) {
            await loadPage(pageId, true);
          } else if (data.project.pages?.length) {
            setPageId(data.project.pages[0].id);
          }
          await onRefresh();
        } catch (cause) {
          showToast(cause.message || String(cause));
        }
      };

      useEffect(() => { void loadPage(pageId); }, [pageId]);
      useEffect(() => {
        const timer = setInterval(() => { void refresh(); }, 8000);
        return () => clearInterval(timer);
      }, [pageId, project.id]);

      const availableTabs = useMemo(() => {
        if (!page) return [];
        return TARGET_ORDER.filter((key) => page.renders?.[key]?.status && page.renders[key].status !== "missing");
      }, [page]);

      const chooseTab = () => {
        if (!page) return;
        const first = TARGET_ORDER.find((key) => page.renders?.[key]?.status && page.renders[key].status !== "missing");
        if (first) setTab(first);
      };

      const startSession = async () => {
        try {
          await openProjectSession(project, settings);
        } catch (cause) {
          showToast(cause.message || String(cause));
        }
      };

      const optimize = async (feedback) => {
        if (!page) return;
        try {
          await sendToProject(project, buildOptimizePrompt(project, page, feedback, settings));
          setOptimizeOpen(false);
          showToast("已发送到内容对话");
        } catch (cause) {
          const text = buildOptimizePrompt(project, page, feedback, settings);
          const copied = await copy(text);
          setOptimizeOpen(false);
          showToast(copied ? "发送失败，提示词已复制；请在对话中粘贴" : `发送失败：${cause.message || cause}`);
        }
      };

      const generate = async (policy, note) => {
        if (!page || !generateTarget) return;
        const text = buildRenderPrompt(project, page, generateTarget, policy, note, settings);
        try {
          await sendToProject(project, text);
          setGenerateTarget(null);
          showToast("已发送到内容对话");
        } catch (cause) {
          const copied = await copy(text);
          showToast(copied ? "发送失败，提示词已复制；请在对话中粘贴" : `发送失败：${cause.message || cause}`);
        }
      };

      const approve = async () => {
        if (!page || !page.currentVersion) return;
        try {
          await requestJson(`api/projects/${encodeURIComponent(project.id)}/pages/${encodeURIComponent(page.id)}/approve`, { method: "POST", body: { version: page.currentVersion } });
          await refresh();
          showToast(`已确认 ${page.id} 的 v${page.currentVersion}`);
        } catch (cause) {
          showToast(cause.message || String(cause));
        }
      };

      return h("div", { style: S.root },
        h("div", { style: S.top },
          h(Button, { variant: "ghost", onClick: onBack }, "← 返回"),
          h("div", { style: { flex: "1 1 auto", minWidth: 200 } },
            h("div", { style: S.h1 }, project.title),
            h("div", { style: { ...S.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" } }, [project.client || "未填客户", `${project.pageCount || 0} 页`, `已确认 ${project.copyApproved || 0}`, project.path].join(" · "))
          ),
          h(Button, { onClick: startSession }, "打开内容对话"),
          h(Button, { onClick: () => void refresh() }, "刷新"),
          h(Button, { style: { color: ACCENT }, onClick: () => void onDelete() }, "删除项目")
        ),
        h("div", { ref: splitRef, style: { ...S.split, gridTemplateColumns: `${split.left}px 6px ${split.middle}px 6px minmax(0,1fr)` } },
          h("div", { style: { ...S.pane, borderRight: `1px solid ${BORDER}` } },
            h("div", { style: { ...S.row, justifyContent: "space-between", marginBottom: 8 } },
              h("div", { style: S.h2 }, "页面"),
              h("span", { style: S.muted }, `${project.pages?.length || 0} 页`)
            ),
            (project.pages || []).map((item) => h("button", {
              key: item.id,
              type: "button",
              style: item.id === pageId ? S.pageItemActive : S.pageItem,
              onClick: () => { setPageId(item.id); },
            },
              h("div", { style: { display: "flex", justifyContent: "space-between", gap: 6 } },
                h("span", { style: { fontWeight: 600 } }, item.id),
                h("span", { style: S.muted }, item.copyStatus === "approved" ? "已确认" : "草稿")
              ),
              h("div", { style: { fontSize: 11, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, item.title),
              h("div", { style: { display: "flex", gap: 4, marginTop: 2 } },
                TARGET_ORDER.map((key) => h("span", { key, title: `${key}: ${statusText(item.renders?.[key]?.status)}` }, statusDot(item.renders?.[key]?.status)))
              )
            )),
            (project.pages || []).length === 0 ? h(Empty, { text: `还没有页面。打开内容对话，让 ${settings?.skills?.content || DEFAULT_SKILLS.content} 先产出蓝图和逐页文案。` }) : null
          ),
          h("div", { style: S.resizer, role: "separator", "aria-orientation": "vertical", title: "拖动调整页面列宽", onPointerDown: (event) => startResize("left", event) }),
          h("div", { style: { ...S.pane, borderRight: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", gap: 10 } },
            page ? h("div", { style: { display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" } },
              h("div", { style: { minWidth: 0 } },
                h("div", { style: { fontWeight: 650, fontSize: 15, lineHeight: 1.35 } }, page.title),
                h("div", { style: S.muted }, `${page.id} · 当前 v${page.currentVersion || 0} · ${page.copyStatus === "approved" ? "已确认" : "草稿"}${page.approvedVersion ? ` · 已确认 v${page.approvedVersion}` : ""}`)
              ),
              h("div", { style: { ...S.row, flexWrap: "wrap", justifyContent: "flex-end" } },
                h(Button, { onClick: async () => { const ok = await copy(page.copy || ""); showToast(ok ? "文案已复制" : "复制失败"); } }, "复制"),
                h(Button, { onClick: () => setOptimizeOpen(true) }, "优化此页"),
                h(Button, { onClick: () => setHistoryOpen(true) }, "历史"),
                h(Button, { variant: "primary", onClick: () => void approve(), disabled: !page.currentVersion }, "确认版本")
              )
            ) : h(Empty, { text: "选择一页查看文案。" }),
            page ? h("pre", { style: S.pre }, page.copy) : null,
            page ? h("div", { style: { ...S.muted, fontSize: 11 } }, `hash ${page.currentHash || "-"} · 更新 ${formatTime(page.updatedAt)}`) : null
          ),
          h("div", { style: S.resizer, role: "separator", "aria-orientation": "vertical", title: "拖动调整文案/预览列宽", onPointerDown: (event) => startResize("middle", event) }),
          h("div", { style: { minHeight: 0, display: "flex", flexDirection: "column" } },
            h("div", { style: S.tabs },
              TARGET_ORDER.map((key) => h("button", {
                key,
                type: "button",
                style: tab === key ? S.tabActive : S.tab,
                onClick: () => setTab(key),
              }, TARGET_LABELS[key]))
            ),
            h("div", { style: { flex: "1 1 auto", minHeight: 0, overflow: "auto", padding: 14 } },
              page ? h(PreviewPane, { project, page, tab, onGenerate: setGenerateTarget }) : h(Empty, { text: "暂无预览。" })
            )
          )
        ),
        page ? h(Matrix, { project, pageId, onSelect: setPageId }) : null,
        historyOpen && page ? h(HistoryModal, {
          project,
          page,
          onClose: () => setHistoryOpen(false),
          showToast,
          onChanged: async () => { await refresh(); },
        }) : null,
        optimizeOpen && page ? h(OptimizeModal, {
          onClose: () => setOptimizeOpen(false),
          onSubmit: optimize,
        }) : null,
        generateTarget && page ? h(GenerateModal, {
          page,
          target: generateTarget,
          onClose: () => setGenerateTarget(null),
          onGenerate: generate,
        }) : null
      );
    }

    function PreviewPane({ project, page, tab, onGenerate }) {
      const render = page.renders?.[tab];
      const previewStage = {
        flex: "1 1 auto",
        minHeight: 300,
        padding: 10,
        borderRadius: 10,
        background: "rgba(128,128,128,.13)",
        border: `1px solid ${SOFT_BORDER}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      };
      if (!render || render.status === "missing") {
        return h("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, paddingTop: 40 } },
          h(Empty, { text: `这一页还没有 ${tab.toUpperCase()} 产物。` }),
          h(Button, { variant: "primary", onClick: () => onGenerate(tab) }, `生成 ${TARGET_LABELS[tab]}`)
        );
      }
      if (tab === "html") {
        return h("div", { style: { height: "100%", minHeight: 300, display: "flex", flexDirection: "column", gap: 6 } },
          h("div", { style: { ...S.row, justifyContent: "space-between", gap: 8 } },
            h("div", { style: { ...S.muted, fontSize: 11, minWidth: 0 } }, `${render.path} · ${statusText(render.status)}`),
            h(Button, { variant: "ghost", onClick: () => onGenerate(tab) }, "重新生成")
          ),
          h("div", { style: previewStage },
            h("iframe", {
              key: `${page.id}-${render.mtimeMs}`,
              src: fileUrl(project.id, render.path),
              sandbox: "allow-scripts",
              style: { width: "100%", height: "100%", minHeight: 300, border: 0, borderRadius: 4, background: "#fff" },
              title: `${page.id} HTML`,
            })
          )
        );
      }
      if (tab === "image") {
        return h("div", { style: { height: "100%", minHeight: 300, display: "flex", flexDirection: "column", gap: 6 } },
          h("div", { style: { ...S.row, justifyContent: "space-between", gap: 8 } },
            h("div", { style: { ...S.muted, fontSize: 11, minWidth: 0 } }, `${render.path} · ${statusText(render.status)}`),
            h(Button, { variant: "ghost", onClick: () => onGenerate(tab) }, "重新生成")
          ),
          h("div", { style: previewStage },
            h("img", { src: fileUrl(project.id, render.path), alt: `${page.id} ${page.title}`, style: { maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4, background: "#fff", boxShadow: "0 1px 8px rgba(0,0,0,.16)" } })
          )
        );
      }
      return h(PptxPreview, { key: `${page.id}-${render.mtimeMs}`, project, page, render, onGenerate });
    }

    function PptxPreview({ project, page, render, onGenerate }) {
      const [loaded, setLoaded] = useState(false);
      const [failed, setFailed] = useState(false);
      const imageUrl = `${previewPptxUrl(project.id, page.id, "image")}&v=${encodeURIComponent(render.mtimeMs || 0)}`;
      const pdfUrl = previewPptxUrl(project.id, page.id, "pdf");
      return h("div", { style: { height: "100%", minHeight: 300, display: "flex", flexDirection: "column", gap: 8 } },
        h("div", { style: { ...S.row, justifyContent: "space-between", gap: 8 } },
          h("div", { style: { ...S.muted, fontSize: 11, minWidth: 0 } },
            `${render.path} · ${statusText(render.status)}${render.deck ? " · 整份 deck 首屏" : ""}`
          ),
          h("div", { style: { ...S.row, flexWrap: "wrap" } },
            h(Button, { variant: "ghost", onClick: () => onGenerate("pptx") }, "重新生成"),
            h("a", { href: pdfUrl, target: "_blank", rel: "noreferrer", style: { color: ACCENT, fontSize: 11 } }, "打开 PDF"),
            h("a", { href: fileUrl(project.id, render.path), target: "_blank", rel: "noreferrer", style: { color: ACCENT, fontSize: 11 } }, "下载 PPTX")
          )
        ),
        !loaded && !failed ? h("div", { style: { ...S.muted, fontSize: 12 } }, "正在生成页面预览…") : null,
        failed
          ? h("div", { style: { color: "#d9534f", fontSize: 12, lineHeight: 1.7 } },
              "PPT 预览生成失败。可以打开 PDF 或下载 PPTX 查看。")
          : h("div", { style: { flex: "1 1 auto", minHeight: 300, padding: 10, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(128,128,128,.13)", border: `1px solid ${SOFT_BORDER}`, borderRadius: 10, overflow: "hidden" } },
              h("img", {
                key: `${page.id}-${render.mtimeMs}`,
                src: imageUrl,
                alt: `${page.id} ${page.title}`,
                onLoad: () => setLoaded(true),
                onError: () => { setLoaded(true); setFailed(true); },
                style: { maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto", objectFit: "contain", display: "block", borderRadius: 4, background: "#fff", boxShadow: "0 1px 8px rgba(0,0,0,.16)" },
              })
            ),
        h("div", { style: { ...S.muted, fontSize: 10.5, lineHeight: 1.6 } },
          "LibreOffice 渲染预览，最终效果以 PowerPoint 为准。"
        )
      );
    }

    function Matrix({ project, pageId, onSelect }) {
      return h("details", { style: { ...S.matrix, margin: "0 18px 14px", flex: "0 0 auto" } },
        h("summary", { style: { cursor: "pointer", fontSize: 12, fontWeight: 600 } }, "页面 × 产物状态矩阵"),
        h("table", { style: { ...S.table, marginTop: 8 } },
          h("thead", null, h("tr", null, ["页面", "文案", "PPTX", "图片", "HTML"].map((label) => h("th", { key: label, style: S.th }, label)))),
          h("tbody", null, (project.pages || []).map((item) => h("tr", { key: item.id, onClick: () => onSelect(item.id), style: { cursor: "pointer" } },
            h("td", { style: S.td }, `${item.id} ${item.title}`),
            h("td", { style: S.td }, item.copyStatus === "approved" ? "已确认" : "草稿"),
            TARGET_ORDER.map((key) => h("td", { key, style: S.td }, h("span", { style: { display: "inline-flex", gap: 5, alignItems: "center" } }, statusDot(item.renders?.[key]?.status), statusText(item.renders?.[key]?.status))))
          )))
        )
      );
    }

    function OptimizeModal({ onClose, onSubmit }) {
      const [feedback, setFeedback] = useState("");
      const [busy, setBusy] = useState(false);
      const submit = async () => {
        if (!feedback.trim()) return;
        setBusy(true);
        await onSubmit(feedback.trim());
        setBusy(false);
      };
      return h("div", { style: S.overlay, onMouseDown: (event) => { if (event.target === event.currentTarget) onClose(); } },
        h("div", { style: S.modal },
          h("div", { style: { ...S.row, justifyContent: "space-between", marginBottom: 12 } }, h("div", { style: S.h1 }, "优化此页"), h(Button, { variant: "ghost", onClick: onClose }, "关闭")),
          h("div", { style: S.muted, marginBottom: 10 }, `反馈会发送到项目内容对话，由 ${settings?.skills?.content || DEFAULT_SKILLS.content} 只改这一页。`),
          h("textarea", { style: { ...S.input, minHeight: 160, resize: "vertical" }, value: feedback, onChange: (event) => setFeedback(event.target.value), placeholder: "例如：第二段太泛，补一个可验证的成果指标；标题更有判断力……" }),
          h("div", { style: { ...S.row, justifyContent: "flex-end", marginTop: 12 } },
            h(Button, { variant: "ghost", onClick: onClose, disabled: busy }, "取消"),
            h(Button, { variant: "primary", onClick: () => void submit(), disabled: busy || !feedback.trim() }, busy ? "发送中…" : "发送到内容对话")
          )
        )
      );
    }

    function HistoryModal({ project, page, onClose, showToast, onChanged }) {
      const [history, setHistory] = useState([]);
      const [selected, setSelected] = useState(null);
      const [loading, setLoading] = useState(true);
      const [busy, setBusy] = useState(false);

      const load = async () => {
        setLoading(true);
        try {
          const data = await requestJson(`api/projects/${encodeURIComponent(project.id)}/pages/${encodeURIComponent(page.id)}/history`);
          setHistory(data.history || []);
          if (data.history?.length) await select(data.history[data.history.length - 1].version);
        } catch (cause) {
          showToast(cause.message || String(cause));
        } finally {
          setLoading(false);
        }
      };

      const select = async (version) => {
        try {
          const data = await requestJson(`api/projects/${encodeURIComponent(project.id)}/pages/${encodeURIComponent(page.id)}/history/${version}`);
          setSelected(data.version);
        } catch (cause) {
          showToast(cause.message || String(cause));
        }
      };

      const approveVersion = async (version) => {
        setBusy(true);
        try {
          await requestJson(`api/projects/${encodeURIComponent(project.id)}/pages/${encodeURIComponent(page.id)}/approve`, { method: "POST", body: { version } });
          await onChanged();
          showToast(`已确认 v${version}`);
        } catch (cause) {
          showToast(cause.message || String(cause));
        } finally {
          setBusy(false);
        }
      };

      const restore = async (version) => {
        if (!window.confirm(`恢复到 v${version}？当前内容会保留在历史里。`)) return;
        setBusy(true);
        try {
          await requestJson(`api/projects/${encodeURIComponent(project.id)}/pages/${encodeURIComponent(page.id)}/restore`, { method: "POST", body: { version } });
          await onChanged();
          await load();
          showToast(`已恢复 v${version}`);
        } catch (cause) {
          showToast(cause.message || String(cause));
        } finally {
          setBusy(false);
        }
      };

      useEffect(() => { void load(); }, []);

      const diff = useMemo(() => selected ? diffLines(page.copy || "", selected.text || "") : [], [selected, page.copy]);

      return h("div", { style: S.overlay, onMouseDown: (event) => { if (event.target === event.currentTarget) onClose(); } },
        h("div", { style: S.modalWide },
          h("div", { style: { ...S.row, justifyContent: "space-between", padding: "14px 16px", borderBottom: `1px solid ${BORDER}` } },
            h("div", null, h("div", { style: S.h2 }, `${page.id} 文案历史`), h("div", { style: S.muted }, "查看、对比、确认或恢复历史版本")),
            h(Button, { variant: "ghost", onClick: onClose }, "关闭")
          ),
          h("div", { style: { display: "grid", gridTemplateColumns: "220px 1fr", minHeight: 420, maxHeight: "70vh", overflow: "hidden" } },
            h("div", { style: { overflow: "auto", borderRight: `1px solid ${BORDER}`, padding: 8 } },
              loading ? h(Empty, { text: "读取历史…" }) : history.length === 0 ? h(Empty, { text: "暂无历史版本" }) : history.slice().reverse().map((item) => h("button", {
                key: item.version,
                type: "button",
                onClick: () => void select(item.version),
                style: { ...(selected?.version === item.version ? S.pageItemActive : S.pageItem), width: "100%" },
              },
                h("div", { style: { display: "flex", justifyContent: "space-between" } }, h("strong", null, `v${item.version}`), h("span", { style: S.muted }, item.hash)),
                h("div", { style: S.muted }, formatTime(new Date(item.mtimeMs).toISOString()))
              ))
            ),
            h("div", { style: { overflow: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 } },
              selected ? h("div", { style: S.row },
                h("strong", null, `v${selected.version}`),
                h(Button, { variant: "primary", onClick: () => void approveVersion(selected.version), disabled: busy }, `确认 v${selected.version}`),
                h(Button, { onClick: () => void restore(selected.version), disabled: busy }, "恢复此版本")
              ) : null,
              selected ? h("div", { style: { fontFamily: MONO, fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", border: `1px solid ${BORDER}`, borderRadius: 8, padding: 10 } },
                diff.map((line, index) => h("div", {
                  key: `${index}-${line.type}`,
                  style: {
                    background: line.type === "add" ? "rgba(46,125,50,.14)" : line.type === "del" ? "rgba(173,1,1,.14)" : "transparent",
                    color: line.type === "add" ? "#2e7d32" : line.type === "del" ? ACCENT : "inherit",
                    textDecoration: line.type === "del" ? "line-through" : "none",
                  },
                }, `${line.type === "add" ? "+ " : line.type === "del" ? "- " : "  "}${line.text}`))
              ) : h(Empty, { text: "选择一个版本查看与当前文案的差异。" })
            )
          )
        )
      );
    }

    function apply(ctx) {
      try {
        services.sessions = ctx.get?.("sessions") ?? null;
        services.uiWorkspace = ctx.get?.("uiWorkspace") ?? null;
        services.workspaces = ctx.get?.("workspaces") ?? null;
      } catch {
        // optional services
      }
      try {
        ctx.inject(["sessions", "uiWorkspace"], (scoped) => {
          services.sessions = scoped.sessions;
          services.uiWorkspace = scoped.uiWorkspace;
          try { services.workspaces = scoped.get?.("workspaces") ?? services.workspaces; } catch {}
        });
      } catch {
        // host without the client services; the page still renders with a warning on actions
      }

      ctx.slots.inject("sidebar.panellist", () => {
        const offMain = ctx.slots.register({ name: "main", key: "deck-workbench" }, () => h(ErrorBoundary, null, h(Workbench)));
        const offIcon = ctx.slots.register({
          name: "sidebar.panellist",
          id: "deck-workbench",
          order: 6,
          label: "方案工作台",
        }, (owner) => h(Icon, { size: owner?.size || 16, active: !!owner?.active }));
        return () => {
          if (typeof offIcon === "function") offIcon();
          if (typeof offMain === "function") offMain();
        };
      });
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return exports;
  },
});
