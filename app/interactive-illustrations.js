/**
 * In-Answer Interactive & Animated Illustrations Engine (60fps, Zero-Dep, XSS-Safe)
 * ─────────────────────────────────────────────────────────────────────────────────
 * Renders structured ```visual JSON specs inside JARVIS answers as smooth, interactive
 * SVG / Retina-Canvas animations with Play/Pause, Replay, Speed (0.5x/1x/2x), and Step
 * controls. Never evaluates arbitrary JavaScript; strictly validates allowlisted types:
 *   - flow       : Animated process / architecture / biology pipeline with traveling pulses
 *   - orbit      : 60fps orbital / atomic / planetary mechanics with velocity trails
 *   - wave       : 60fps sine/cosine/interference wave + optional unit-circle projection
 *   - sort       : Animated sorting algorithm (live compare & swap highlights)
 *   - bars       : Smooth spring-eased comparative data bar chart
 *   - projectile : 60fps kinematics trajectory with velocity vectors & apex marker
 *   - steps      : Multi-stage interactive storyboard with Prev/Next/Auto-Play
 */

const ALLOWED_VISUAL_TYPES = new Set(['flow', 'orbit', 'wave', 'sort', 'bars', 'projectile', 'steps']);

const PALETTE = [
    '#38bdf8', // sky
    '#34d399', // emerald
    '#a78bfa', // violet
    '#fbbf24', // amber
    '#fb7185', // rose
    '#2dd4bf', // teal
    '#60a5fa', // blue
    '#f472b6'  // pink
];

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function clampNum(val, fallback, min, max) {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function sanitizeLabel(val, maxLen = 64) {
    return String(val ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function sanitizeColor(val, fallbackIdx = 0) {
    const raw = String(val || '').trim();
    if (/^#[0-9a-f]{3,8}$/i.test(raw)) return raw;
    return PALETTE[Math.abs(fallbackIdx) % PALETTE.length];
}

function prefersReducedMotion() {
    try {
        return Boolean(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    } catch (_) {
        return false;
    }
}

/**
 * Strictly validates and normalizes a raw JSON visual specification.
 */
export function parseVisualSpec(rawInput) {
    let rawObj = rawInput;
    if (typeof rawInput === 'string') {
        const cleaned = rawInput.trim().replace(/^```(?:visual|json)?\s*/i, '').replace(/```\s*$/, '').trim();
        try {
            rawObj = JSON.parse(cleaned);
        } catch (_) {
            return null;
        }
    }
    if (!rawObj || typeof rawObj !== 'object' || Array.isArray(rawObj)) return null;

    const rawType = String(rawObj.type || rawObj.kind || '').trim().toLowerCase();
    const type = ALLOWED_VISUAL_TYPES.has(rawType) ? rawType : (
        Array.isArray(rawObj.nodes) ? 'flow' :
        Array.isArray(rawObj.orbits) || Array.isArray(rawObj.bodies) ? 'orbit' :
        Array.isArray(rawObj.waves) ? 'wave' :
        Array.isArray(rawObj.values) ? (rawObj.algorithm ? 'sort' : 'bars') :
        Array.isArray(rawObj.steps) ? 'steps' : ''
    );
    if (!type) return null;

    const base = {
        type,
        title: sanitizeLabel(rawObj.title || `${type.charAt(0).toUpperCase() + type.slice(1)} Illustration`, 90),
        caption: sanitizeLabel(rawObj.caption || rawObj.subtitle || '', 220)
    };

    if (type === 'flow') {
        const rawNodes = Array.isArray(rawObj.nodes) ? rawObj.nodes.slice(0, 8) : [];
        const nodes = rawNodes.length
            ? rawNodes.map((n, idx) => ({
                id: sanitizeLabel(n?.id || `n${idx + 1}`, 24),
                label: sanitizeLabel(typeof n === 'string' ? n : (n?.label || n?.name || `Step ${idx + 1}`), 32),
                sublabel: sanitizeLabel(n?.sublabel || n?.detail || '', 42),
                color: sanitizeColor(n?.color, idx)
            }))
            : [
                { id: 'n1', label: 'Input', sublabel: 'Request', color: PALETTE[0] },
                { id: 'n2', label: 'Process', sublabel: 'Transform', color: PALETTE[2] },
                { id: 'n3', label: 'Output', sublabel: 'Result', color: PALETTE[1] }
            ];
        const rawEdges = Array.isArray(rawObj.edges) ? rawObj.edges.slice(0, 12) : [];
        const edges = rawEdges.length
            ? rawEdges.map(e => ({
                from: sanitizeLabel(e?.from, 24),
                to: sanitizeLabel(e?.to, 24),
                label: sanitizeLabel(e?.label || '', 24)
            })).filter(e => e.from && e.to)
            : nodes.slice(0, -1).map((n, i) => ({ from: n.id, to: nodes[i + 1].id, label: '' }));
        return { ...base, nodes, edges };
    }

    if (type === 'orbit') {
        const rawBodies = Array.isArray(rawObj.bodies || rawObj.orbits) ? (rawObj.bodies || rawObj.orbits).slice(0, 8) : [];
        const bodies = rawBodies.length
            ? rawBodies.map((b, idx) => ({
                label: sanitizeLabel(b?.label || b?.name || `Body ${idx + 1}`, 24),
                radius: clampNum(b?.radius, 38 + idx * 24, 22, 130),
                size: clampNum(b?.size, 6, 3, 14),
                speed: clampNum(b?.speed, 1.4 / (idx + 1), 0.15, 4),
                phase: clampNum(b?.phase, idx * 1.1, 0, Math.PI * 2),
                color: sanitizeColor(b?.color, idx)
            }))
            : [
                { label: 'Inner', radius: 42, size: 6, speed: 1.5, phase: 0, color: PALETTE[0] },
                { label: 'Middle', radius: 74, size: 8, speed: 0.9, phase: 2.1, color: PALETTE[1] },
                { label: 'Outer', radius: 106, size: 7, speed: 0.55, phase: 4.2, color: PALETTE[2] }
            ];
        return {
            ...base,
            centerLabel: sanitizeLabel(rawObj.centerLabel || rawObj.center || 'Core', 24),
            centerColor: sanitizeColor(rawObj.centerColor || '#fbbf24', 3),
            bodies
        };
    }

    if (type === 'wave') {
        const rawWaves = Array.isArray(rawObj.waves) ? rawObj.waves.slice(0, 4) : [];
        const waves = rawWaves.length
            ? rawWaves.map((w, idx) => ({
                label: sanitizeLabel(w?.label || `Wave ${idx + 1}`, 28),
                amplitude: clampNum(w?.amplitude, 42 - idx * 8, 8, 72),
                frequency: clampNum(w?.frequency, 1.5 + idx * 0.7, 0.25, 6),
                speed: clampNum(w?.speed, 1.8, 0.2, 5),
                phase: clampNum(w?.phase, idx * 0.8, 0, Math.PI * 2),
                color: sanitizeColor(w?.color, idx)
            }))
            : [
                { label: 'sin(x)', amplitude: 46, frequency: 1.5, speed: 1.8, phase: 0, color: PALETTE[0] },
                { label: 'cos(x)', amplitude: 36, frequency: 1.5, speed: 1.8, phase: Math.PI / 2, color: PALETTE[2] }
            ];
        return {
            ...base,
            showSum: rawObj.showSum === true,
            showUnitCircle: rawObj.showUnitCircle !== false && waves.length === 1,
            waves
        };
    }

    if (type === 'sort' || type === 'bars') {
        const rawItems = Array.isArray(rawObj.items)
            ? rawObj.items.slice(0, 14)
            : (Array.isArray(rawObj.values) ? rawObj.values.slice(0, 14) : [42, 18, 75, 31, 64, 12, 53, 29]);
        const items = rawItems.map((it, idx) => {
            if (typeof it === 'number') {
                return { label: String(it), value: clampNum(it, 10, 1, 100000), color: sanitizeColor('', idx) };
            }
            return {
                label: sanitizeLabel(it?.label || it?.name || String(it?.value ?? idx + 1), 18),
                value: clampNum(it?.value, 10, 0, 1000000),
                color: sanitizeColor(it?.color, idx)
            };
        });
        return {
            ...base,
            algorithm: type === 'sort' ? sanitizeLabel(rawObj.algorithm || 'bubble', 20).toLowerCase() : '',
            unit: sanitizeLabel(rawObj.unit || '', 12),
            items
        };
    }

    if (type === 'projectile') {
        return {
            ...base,
            angleDeg: clampNum(rawObj.angleDeg ?? rawObj.angle, 45, 10, 82),
            velocity: clampNum(rawObj.velocity ?? rawObj.speed, 28, 5, 120),
            gravity: clampNum(rawObj.gravity, 9.81, 1.6, 25),
            showVectors: rawObj.showVectors !== false
        };
    }

    if (type === 'steps') {
        const rawSteps = Array.isArray(rawObj.steps) ? rawObj.steps.slice(0, 10) : [];
        const steps = rawSteps.length
            ? rawSteps.map((s, idx) => ({
                title: sanitizeLabel(typeof s === 'string' ? `Step ${idx + 1}` : (s?.title || `Step ${idx + 1}`), 64),
                detail: sanitizeLabel(typeof s === 'string' ? s : (s?.detail || s?.description || s?.text || ''), 220),
                badge: sanitizeLabel(s?.badge || `${idx + 1}`, 16),
                color: sanitizeColor(s?.color, idx)
            }))
            : [{ title: 'Stage 1', detail: 'Interactive step illustration.', badge: '1', color: PALETTE[0] }];
        return { ...base, steps };
    }

    return null;
}

/**
 * Generates XSS-safe HTML mount markup for `markdown-renderer.js`.
 */
export function renderInteractiveVisualMarkup(rawJson, blockId = '') {
    const spec = parseVisualSpec(rawJson);
    if (!spec) return null;
    const safeId = escapeHtml(blockId || `vis_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`);
    const encodedSpec = encodeURIComponent(JSON.stringify(spec));
    const typeLabel = spec.type.toUpperCase();
    return `
        <div class="jarvis-visual-card" id="visual_card_${safeId}" data-visual-id="${safeId}" data-visual-type="${escapeHtml(spec.type)}" data-visual-spec="${encodedSpec}">
            <div class="jarvis-visual-header">
                <div class="jarvis-visual-title-group">
                    <span class="jarvis-visual-badge">${escapeHtml(typeLabel)}</span>
                    <span class="jarvis-visual-title">${escapeHtml(spec.title)}</span>
                </div>
                <div class="jarvis-visual-controls">
                    <button type="button" class="jarvis-visual-btn" data-visual-action="toggle" aria-label="Pause or play animation">Pause</button>
                    <button type="button" class="jarvis-visual-btn" data-visual-action="replay" aria-label="Replay animation">Replay</button>
                    <button type="button" class="jarvis-visual-btn" data-visual-action="speed" aria-label="Cycle animation speed">1x</button>
                </div>
            </div>
            <div class="jarvis-visual-stage" data-visual-stage></div>
            ${spec.caption ? `<div class="jarvis-visual-caption">${escapeHtml(spec.caption)}</div>` : ''}
        </div>
    `;
}

// ─── RENDERER CONTROLLERS (60FPS CANVAS & SVG) ───────────────────────────────

function setupCanvas(stage, height = 220) {
    const canvas = document.createElement('canvas');
    canvas.className = 'jarvis-visual-canvas';
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const cssWidth = Math.max(320, Math.min(680, stage.clientWidth || 540));
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = '100%';
    canvas.style.height = `${height}px`;
    stage.innerHTML = '';
    stage.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { canvas, ctx, width: cssWidth, height };
}

function getThemeColors() {
    const isLight = typeof document !== 'undefined' && !document.body.classList.contains('dark');
    return {
        text: isLight ? '#0f172a' : '#f1f5f9',
        muted: isLight ? '#64748b' : '#94a3b8',
        grid: isLight ? 'rgba(15, 23, 42, 0.08)' : 'rgba(148, 163, 184, 0.14)',
        surface: isLight ? 'rgba(241, 245, 249, 0.9)' : 'rgba(15, 23, 42, 0.65)',
        border: isLight ? 'rgba(15, 23, 42, 0.14)' : 'rgba(255, 255, 255, 0.14)'
    };
}

function mountFlowVisual(stage, spec, ctrl) {
    const { ctx, width, height } = setupCanvas(stage, 210);
    const count = spec.nodes.length;
    const padX = 56;
    const usableW = Math.max(160, width - padX * 2);
    const positions = new Map();
    const rows = count > 4 ? 2 : 1;
    const perRow = Math.ceil(count / rows);
    spec.nodes.forEach((n, idx) => {
        const row = rows === 1 ? 0 : Math.floor(idx / perRow);
        const col = rows === 1 ? idx : (idx % perRow);
        const rowCount = rows === 1 ? count : (row === 0 ? perRow : count - perRow);
        const x = rowCount === 1 ? width / 2 : padX + (col / (rowCount - 1)) * usableW;
        const y = rows === 1 ? height / 2 : (row === 0 ? 64 : height - 60);
        positions.set(n.id, { x, y, node: n, idx });
    });

    let t = 0;
    return {
        reset() { t = 0; },
        render(dt) {
            t += dt * ctrl.speed * (ctrl.playing ? 0.65 : 0);
            const theme = getThemeColors();
            ctx.clearRect(0, 0, width, height);

            // Draw curved edges + animated traveling particles
            spec.edges.forEach((edge, eIdx) => {
                const a = positions.get(edge.from);
                const b = positions.get(edge.to);
                if (!a || !b) return;
                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2 - (a.y === b.y ? 20 : 0);

                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.quadraticCurveTo(mx, my, b.x, b.y);
                ctx.strokeStyle = theme.grid;
                ctx.lineWidth = 2.5;
                ctx.stroke();

                // Animated packet along quadratic curve
                const u = (t + eIdx * 0.27) % 1;
                const inv = 1 - u;
                const px = inv * inv * a.x + 2 * inv * u * mx + u * u * b.x;
                const py = inv * inv * a.y + 2 * inv * u * my + u * u * b.y;
                ctx.beginPath();
                ctx.arc(px, py, 4.5, 0, Math.PI * 2);
                ctx.fillStyle = a.node.color;
                ctx.shadowColor = a.node.color;
                ctx.shadowBlur = 10;
                ctx.fill();
                ctx.shadowBlur = 0;

                if (edge.label) {
                    ctx.font = '500 10px Inter, system-ui, sans-serif';
                    ctx.fillStyle = theme.muted;
                    ctx.textAlign = 'center';
                    ctx.fillText(edge.label, mx, my - 6);
                }
            });

            // Draw nodes with pulsing active ring
            const activeNodeIdx = Math.floor(t * count) % count;
            spec.nodes.forEach((n, idx) => {
                const pos = positions.get(n.id);
                const isActive = idx === activeNodeIdx;
                const boxW = Math.min(118, Math.max(76, usableW / Math.max(1, perRow) - 18));
                const boxH = 44;
                const rx = pos.x - boxW / 2;
                const ry = pos.y - boxH / 2;

                ctx.save();
                ctx.beginPath();
                ctx.roundRect(rx, ry, boxW, boxH, 10);
                ctx.fillStyle = theme.surface;
                ctx.fill();
                ctx.lineWidth = isActive ? 2.2 : 1.2;
                ctx.strokeStyle = isActive ? n.color : theme.border;
                if (isActive) {
                    ctx.shadowColor = n.color;
                    ctx.shadowBlur = 12;
                }
                ctx.stroke();
                ctx.restore();

                ctx.font = '600 11.5px Inter, system-ui, sans-serif';
                ctx.fillStyle = theme.text;
                ctx.textAlign = 'center';
                ctx.fillText(n.label.slice(0, 16), pos.x, pos.y - (n.sublabel ? 3 : -4));
                if (n.sublabel) {
                    ctx.font = '400 9.5px Inter, system-ui, sans-serif';
                    ctx.fillStyle = theme.muted;
                    ctx.fillText(n.sublabel.slice(0, 18), pos.x, pos.y + 12);
                }
            });
        }
    };
}

function mountOrbitVisual(stage, spec, ctrl) {
    const { ctx, width, height } = setupCanvas(stage, 250);
    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.max(...spec.bodies.map(b => b.radius), 100);
    const scale = Math.min(1, (Math.min(width, height) * 0.42) / maxR);
    let t = 0;

    return {
        reset() { t = 0; },
        render(dt) {
            t += dt * ctrl.speed * (ctrl.playing ? 1 : 0);
            const theme = getThemeColors();
            ctx.clearRect(0, 0, width, height);

            // Central star / nucleus
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, 16, 0, Math.PI * 2);
            ctx.fillStyle = spec.centerColor;
            ctx.shadowColor = spec.centerColor;
            ctx.shadowBlur = 18;
            ctx.fill();
            ctx.restore();
            ctx.font = '600 10px Inter, system-ui, sans-serif';
            ctx.fillStyle = theme.text;
            ctx.textAlign = 'center';
            ctx.fillText(spec.centerLabel, cx, cy + 28);

            // Orbits & bodies
            spec.bodies.forEach(body => {
                const r = body.radius * scale;
                const ry = r * 0.72;
                ctx.beginPath();
                ctx.ellipse(cx, cy, r, ry, 0, 0, Math.PI * 2);
                ctx.strokeStyle = theme.grid;
                ctx.lineWidth = 1.2;
                ctx.stroke();

                const angle = body.phase + t * body.speed;
                // Fading arc trail
                for (let k = 8; k >= 1; k -= 1) {
                    const aTrail = angle - k * 0.08 * body.speed;
                    const tx = cx + Math.cos(aTrail) * r;
                    const ty = cy + Math.sin(aTrail) * ry;
                    ctx.beginPath();
                    ctx.arc(tx, ty, Math.max(1.5, body.size * (1 - k / 10) * 0.65), 0, Math.PI * 2);
                    ctx.fillStyle = body.color + Math.round((1 - k / 10) * 90).toString(16).padStart(2, '0');
                    ctx.fill();
                }

                const bx = cx + Math.cos(angle) * r;
                const by = cy + Math.sin(angle) * ry;
                ctx.save();
                ctx.beginPath();
                ctx.arc(bx, by, body.size, 0, Math.PI * 2);
                ctx.fillStyle = body.color;
                ctx.shadowColor = body.color;
                ctx.shadowBlur = 10;
                ctx.fill();
                ctx.restore();

                ctx.font = '500 10px Inter, system-ui, sans-serif';
                ctx.fillStyle = theme.muted;
                ctx.textAlign = 'center';
                ctx.fillText(body.label, bx, by - body.size - 5);
            });
        }
    };
}

function mountWaveVisual(stage, spec, ctrl) {
    const { ctx, width, height } = setupCanvas(stage, 210);
    const cy = height / 2;
    let t = 0;

    return {
        reset() { t = 0; },
        render(dt) {
            t += dt * ctrl.speed * (ctrl.playing ? 1 : 0);
            const theme = getThemeColors();
            ctx.clearRect(0, 0, width, height);

            // Center axes
            ctx.beginPath();
            ctx.moveTo(16, cy);
            ctx.lineTo(width - 16, cy);
            ctx.strokeStyle = theme.grid;
            ctx.lineWidth = 1.2;
            ctx.stroke();

            const startX = spec.showUnitCircle ? 128 : 20;
            const spanW = Math.max(120, width - startX - 20);

            if (spec.showUnitCircle && spec.waves[0]) {
                const w0 = spec.waves[0];
                const ucx = 64;
                const r = Math.min(44, w0.amplitude);
                const ang = t * w0.speed + w0.phase;
                const px = ucx + Math.cos(ang) * r;
                const py = cy - Math.sin(ang) * r;
                ctx.beginPath();
                ctx.arc(ucx, cy, r, 0, Math.PI * 2);
                ctx.strokeStyle = theme.grid;
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(ucx, cy);
                ctx.lineTo(px, py);
                ctx.lineTo(startX, py);
                ctx.strokeStyle = w0.color;
                ctx.lineWidth = 1.6;
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(px, py, 4.5, 0, Math.PI * 2);
                ctx.fillStyle = w0.color;
                ctx.fill();
            }

            spec.waves.forEach((w, idx) => {
                ctx.beginPath();
                for (let x = 0; x <= spanW; x += 3) {
                    const rad = (x / spanW) * Math.PI * 2 * w.frequency - t * w.speed + w.phase;
                    const y = cy - Math.sin(rad) * w.amplitude;
                    if (x === 0) ctx.moveTo(startX + x, y);
                    else ctx.lineTo(startX + x, y);
                }
                ctx.strokeStyle = w.color;
                ctx.lineWidth = 2.4;
                ctx.stroke();

                // Legend pill
                ctx.font = '600 10.5px Inter, system-ui, sans-serif';
                ctx.fillStyle = w.color;
                ctx.textAlign = 'left';
                ctx.fillText(`● ${w.label}`, 16 + idx * 100, 18);
            });

            if (spec.showSum && spec.waves.length > 1) {
                ctx.beginPath();
                for (let x = 0; x <= spanW; x += 3) {
                    let sumY = 0;
                    for (const w of spec.waves) {
                        const rad = (x / spanW) * Math.PI * 2 * w.frequency - t * w.speed + w.phase;
                        sumY += Math.sin(rad) * (w.amplitude * 0.6);
                    }
                    const y = cy - sumY;
                    if (x === 0) ctx.moveTo(startX + x, y);
                    else ctx.lineTo(startX + x, y);
                }
                ctx.strokeStyle = '#ffffff';
                ctx.setLineDash([4, 3]);
                ctx.lineWidth = 1.8;
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }
    };
}

function mountBarsOrSortVisual(stage, spec, ctrl) {
    const { ctx, width, height } = setupCanvas(stage, 210);
    const isSort = spec.type === 'sort';
    const maxVal = Math.max(...spec.items.map(i => i.value), 1);

    // Precompute bubble sort frames cleanly for deterministic replay
    const frames = [];
    if (isSort) {
        const arr = spec.items.map(i => ({ ...i }));
        frames.push({ arr: arr.map(x => ({ ...x })), active: [], sortedFrom: arr.length });
        for (let i = 0; i < arr.length; i += 1) {
            for (let j = 0; j < arr.length - i - 1; j += 1) {
                frames.push({ arr: arr.map(x => ({ ...x })), active: [j, j + 1], sortedFrom: arr.length - i });
                if (arr[j].value > arr[j + 1].value) {
                    const tmp = arr[j];
                    arr[j] = arr[j + 1];
                    arr[j + 1] = tmp;
                    frames.push({ arr: arr.map(x => ({ ...x })), active: [j, j + 1], swapped: true, sortedFrom: arr.length - i });
                }
            }
        }
        frames.push({ arr: arr.map(x => ({ ...x })), active: [], sortedFrom: 0 });
    }

    let t = 0;
    return {
        reset() { t = 0; },
        render(dt) {
            t += dt * ctrl.speed * (ctrl.playing ? 1 : 0);
            const theme = getThemeColors();
            ctx.clearRect(0, 0, width, height);

            const frame = isSort
                ? frames[Math.min(frames.length - 1, Math.floor(t * 2.4) % (frames.length + 3))]
                : { arr: spec.items, active: [], sortedFrom: 999 };
            const items = frame.arr;
            const padX = 24;
            const gap = 10;
            const barW = Math.max(16, (width - padX * 2 - gap * (items.length - 1)) / items.length);
            const baseLine = height - 30;
            const maxH = height - 66;
            const grow = isSort ? 1 : Math.min(1, 1 - Math.pow(1 - Math.min(1, t * 1.4), 3));

            items.forEach((item, idx) => {
                const h = Math.max(8, (item.value / maxVal) * maxH * grow);
                const x = padX + idx * (barW + gap);
                const y = baseLine - h;
                const isActive = frame.active.includes(idx);
                const isSorted = isSort && idx >= frame.sortedFrom;
                const fill = isActive ? (frame.swapped ? '#fb7185' : '#fbbf24') : (isSorted ? '#34d399' : item.color);

                ctx.save();
                ctx.beginPath();
                ctx.roundRect(x, y, barW, h, [6, 6, 2, 2]);
                ctx.fillStyle = fill;
                if (isActive) {
                    ctx.shadowColor = fill;
                    ctx.shadowBlur = 12;
                }
                ctx.fill();
                ctx.restore();

                ctx.font = '600 10px Inter, system-ui, sans-serif';
                ctx.fillStyle = theme.text;
                ctx.textAlign = 'center';
                ctx.fillText(`${item.value}${spec.unit ? spec.unit : ''}`, x + barW / 2, y - 6);

                ctx.font = '500 10px Inter, system-ui, sans-serif';
                ctx.fillStyle = theme.muted;
                ctx.fillText(item.label.slice(0, 10), x + barW / 2, height - 12);
            });
        }
    };
}

function mountProjectileVisual(stage, spec, ctrl) {
    const { ctx, width, height } = setupCanvas(stage, 220);
    const rad = (spec.angleDeg * Math.PI) / 180;
    const vx = spec.velocity * Math.cos(rad);
    const vy0 = spec.velocity * Math.sin(rad);
    const totalTime = (2 * vy0) / spec.gravity;
    const range = vx * totalTime;
    const maxHeight = (vy0 * vy0) / (2 * spec.gravity);

    const padX = 34;
    const groundY = height - 30;
    const scaleX = (width - padX * 2) / Math.max(range, 1);
    const scaleY = (height - 68) / Math.max(maxHeight, 1);
    let elapsed = 0;

    return {
        reset() { elapsed = 0; },
        render(dt) {
            elapsed += dt * ctrl.speed * (ctrl.playing ? 1 : 0);
            const curT = elapsed % (totalTime + 0.8);
            const clampedT = Math.min(totalTime, curT);
            const theme = getThemeColors();
            ctx.clearRect(0, 0, width, height);

            // Ground line
            ctx.beginPath();
            ctx.moveTo(16, groundY);
            ctx.lineTo(width - 16, groundY);
            ctx.strokeStyle = theme.grid;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Full dashed theoretical arc
            ctx.beginPath();
            for (let i = 0; i <= 50; i += 1) {
                const st = (i / 50) * totalTime;
                const x = padX + vx * st * scaleX;
                const y = groundY - (vy0 * st - 0.5 * spec.gravity * st * st) * scaleY;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = theme.grid;
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.setLineDash([]);

            // Traveled glowing arc
            ctx.beginPath();
            for (let i = 0; i <= 40; i += 1) {
                const st = (i / 40) * clampedT;
                const x = padX + vx * st * scaleX;
                const y = groundY - (vy0 * st - 0.5 * spec.gravity * st * st) * scaleY;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 2.6;
            ctx.stroke();

            const px = padX + vx * clampedT * scaleX;
            const py = groundY - Math.max(0, vy0 * clampedT - 0.5 * spec.gravity * clampedT * clampedT) * scaleY;
            const curVy = vy0 - spec.gravity * clampedT;

            if (spec.showVectors) {
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(px + 26, py);
                ctx.strokeStyle = '#34d399';
                ctx.lineWidth = 2;
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(px, py - (curVy / Math.max(1, spec.velocity)) * 34);
                ctx.strokeStyle = '#fb7185';
                ctx.lineWidth = 2;
                ctx.stroke();
            }

            ctx.save();
            ctx.beginPath();
            ctx.arc(px, py, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#38bdf8';
            ctx.shadowColor = '#38bdf8';
            ctx.shadowBlur = 12;
            ctx.fill();
            ctx.restore();

            ctx.font = '500 10.5px Inter, system-ui, sans-serif';
            ctx.fillStyle = theme.muted;
            ctx.textAlign = 'left';
            ctx.fillText(`θ=${spec.angleDeg}° · v₀=${spec.velocity} m/s · Range=${range.toFixed(1)}m · Max H=${maxHeight.toFixed(1)}m`, 18, 18);
        }
    };
}

function mountStepsVisual(stage, spec, ctrl) {
    let idx = 0;
    let accum = 0;

    const renderDom = () => {
        const s = spec.steps[idx] || spec.steps[0];
        stage.innerHTML = `
            <div class="jarvis-visual-steps-wrap">
                <div class="jarvis-visual-steps-rail">
                    ${spec.steps.map((st, i) => `
                        <button type="button" class="jarvis-visual-step-dot${i === idx ? ' is-active' : ''}" data-step-idx="${i}" style="--step-accent:${escapeHtml(st.color)}">
                            ${escapeHtml(st.badge)}
                        </button>
                    `).join('')}
                </div>
                <div class="jarvis-visual-step-card" style="border-left: 3px solid ${escapeHtml(s.color)};">
                    <div class="jarvis-visual-step-title">${escapeHtml(s.title)}</div>
                    <div class="jarvis-visual-step-detail">${escapeHtml(s.detail)}</div>
                </div>
            </div>
        `;
        stage.querySelectorAll('[data-step-idx]').forEach(btn => {
            btn.addEventListener('click', () => {
                idx = Number(btn.dataset.stepIdx) || 0;
                accum = 0;
                renderDom();
            });
        });
    };
    renderDom();

    return {
        reset() { idx = 0; accum = 0; renderDom(); },
        render(dt) {
            if (!ctrl.playing || spec.steps.length <= 1) return;
            accum += dt * ctrl.speed;
            if (accum >= 2.8) {
                accum = 0;
                idx = (idx + 1) % spec.steps.length;
                renderDom();
            }
        }
    };
}

/**
 * Mounts and animates a single `.jarvis-visual-card` element cleanly.
 */
export function mountInteractiveVisualCard(card) {
    if (!card || card.dataset.visualMounted === 'true') return false;
    const rawEncoded = card.dataset.visualSpec;
    if (!rawEncoded) return false;
    let spec;
    try {
        spec = parseVisualSpec(JSON.parse(decodeURIComponent(rawEncoded)));
    } catch (_) {
        return false;
    }
    if (!spec) return false;

    const stage = card.querySelector('[data-visual-stage]');
    if (!stage) return false;
    card.dataset.visualMounted = 'true';

    const ctrl = {
        playing: !prefersReducedMotion(),
        speed: 1,
        visible: true,
        rafId: null
    };

    const mounters = {
        flow: mountFlowVisual,
        orbit: mountOrbitVisual,
        wave: mountWaveVisual,
        sort: mountBarsOrSortVisual,
        bars: mountBarsOrSortVisual,
        projectile: mountProjectileVisual,
        steps: mountStepsVisual
    };
    const instance = (mounters[spec.type] || mountStepsVisual)(stage, spec, ctrl);
    if (!instance) return false;

    const toggleBtn = card.querySelector('[data-visual-action="toggle"]');
    const replayBtn = card.querySelector('[data-visual-action="replay"]');
    const speedBtn = card.querySelector('[data-visual-action="speed"]');

    const syncButtons = () => {
        if (toggleBtn) toggleBtn.textContent = ctrl.playing ? 'Pause' : 'Play';
        if (speedBtn) speedBtn.textContent = `${ctrl.speed}x`;
    };
    syncButtons();

    toggleBtn?.addEventListener('click', () => {
        ctrl.playing = !ctrl.playing;
        syncButtons();
        if (ctrl.playing && !ctrl.rafId) scheduleLoop();
    });
    replayBtn?.addEventListener('click', () => {
        instance.reset?.();
        ctrl.playing = true;
        syncButtons();
        instance.render(0.016);
        if (!ctrl.rafId) scheduleLoop();
    });
    speedBtn?.addEventListener('click', () => {
        ctrl.speed = ctrl.speed === 1 ? 2 : (ctrl.speed === 2 ? 0.5 : 1);
        syncButtons();
    });

    // Render initial frame immediately
    instance.render(0.016);

    let lastTs = performance.now();
    const tick = (now) => {
        ctrl.rafId = null;
        if (!card.isConnected) return;
        const dt = Math.min(0.06, Math.max(0.001, (now - lastTs) / 1000));
        lastTs = now;
        if (ctrl.visible && ctrl.playing) {
            instance.render(dt);
            ctrl.rafId = requestAnimationFrame(tick);
        }
    };
    const scheduleLoop = () => {
        if (!ctrl.rafId && typeof requestAnimationFrame === 'function' && ctrl.visible && ctrl.playing) {
            lastTs = performance.now();
            ctrl.rafId = requestAnimationFrame(tick);
        }
    };

    if (typeof IntersectionObserver === 'function') {
        const io = new IntersectionObserver((entries) => {
            const isVis = Boolean(entries[0]?.isIntersecting);
            ctrl.visible = isVis;
            if (isVis && ctrl.playing) scheduleLoop();
        }, { threshold: 0.05 });
        io.observe(card);
    }

    if (ctrl.playing) scheduleLoop();
    return true;
}

export function hydrateInteractiveIllustrations(root = (typeof document !== 'undefined' ? document : null)) {
    if (!root || typeof root.querySelectorAll !== 'function') return 0;
    let mounted = 0;
    root.querySelectorAll('.jarvis-visual-card[data-visual-spec]:not([data-visual-mounted="true"])').forEach(card => {
        if (mountInteractiveVisualCard(card)) mounted += 1;
    });
    return mounted;
}

export function installInteractiveIllustrationObserver() {
    if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return;
    if (globalThis.__jarvisVisualObserverInstalled) return;
    globalThis.__jarvisVisualObserverInstalled = true;
    hydrateInteractiveIllustrations(document);
    const observer = new MutationObserver(() => {
        hydrateInteractiveIllustrations(document);
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
}
