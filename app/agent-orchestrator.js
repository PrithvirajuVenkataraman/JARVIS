/**
 * Multi-Agent Workflow Engine (DAG Task Orchestration)
 * Coordinates 4 specialized agents: Planner, Researcher, Coder, and Synthesizer.
 */

export function textToEmbeddingVector(text, dim = 512) {
    const v = new Float32Array(dim);
    const tokens = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return v;
    for (const token of tokens) {
        let h1 = 0x811c9dc5;
        let h2 = 0x5bd1e995;
        for (let i = 0; i < token.length; i++) {
            const code = token.charCodeAt(i);
            h1 ^= code;
            h1 = Math.imul(h1, 0x01000193);
            h2 ^= code;
            h2 = Math.imul(h2, 0x5bd1e995);
        }
        const idx1 = Math.abs(h1) % dim;
        const idx2 = Math.abs(h2) % dim;
        v[idx1] += 1.0;
        v[idx2] += 0.5;
        if (token.length >= 4) {
            for (let i = 0; i < token.length - 2; i++) {
                const trigram = token.slice(i, i + 3);
                let th = 0;
                for (let j = 0; j < trigram.length; j++) th = (th * 31 + trigram.charCodeAt(j)) | 0;
                v[Math.abs(th) % dim] += 0.2;
            }
        }
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < dim; i++) v[i] /= norm;
    }
    return v;
}

export function vectorCosineSimilarity(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
}

const COMPLEX_GOAL_VECTOR = textToEmbeddingVector('research analyze investigate compare top approaches matrix write implementation full script architecture report breakdown');
const CODE_TASK_VECTOR = textToEmbeddingVector('write code script function implementation app config class typescript javascript python sql syntax');
const RESEARCH_TASK_VECTOR = textToEmbeddingVector('latest current recent breakthrough search market compare pricing review trends news live facts');

export const AGENT_ROLES = {
    PLANNER: 'planner',
    RESEARCHER: 'researcher',
    CODER: 'coder',
    SYNTHESIZER: 'synthesizer'
};

export const TASK_STATUS = {
    PENDING: 'pending',
    RUNNING: 'running',
    COMPLETED: 'completed',
    FAILED: 'failed',
    SKIPPED: 'skipped'
};

export function isComplexAgentGoal(text = '') {
    const raw = String(text || '').trim();
    if (!raw) return false;
    if (/^\/(?:agent|workflow|swarm)\b/i.test(raw)) return true;

    const vec = textToEmbeddingVector(raw);
    const complexSim = vectorCosineSimilarity(vec, COMPLEX_GOAL_VECTOR);

    if (complexSim >= 0.22 && raw.length > 50) {
        return true;
    }

    if (raw.length > 120 && /\b(?:compare|analyze|research|build|create|write|implement)\b/i.test(raw) && /\b(?:and|with|then|including|matrix|report|architecture)\b/i.test(raw)) {
        return true;
    }
    return false;
}

export function cleanAgentPrompt(text = '') {
    return String(text || '').replace(/^\/(?:agent|workflow|swarm)\s*/i, '').trim();
}

export function buildAgentWorkflowDag(userGoal = '') {
    const goal = cleanAgentPrompt(userGoal);
    const goalVec = textToEmbeddingVector(goal);

    const codeSim = vectorCosineSimilarity(goalVec, CODE_TASK_VECTOR);
    const researchSim = vectorCosineSimilarity(goalVec, RESEARCH_TASK_VECTOR);

    const requiresCode = codeSim >= 0.16 || /\b(?:code|script|function|app|config|implement|class|component|api|html|python|javascript|ts|css)\b/i.test(goal);
    const requiresSearch = researchSim >= 0.16 || /\b(?:latest|current|recent|compare|review|market|pricing|vs|best|trends?|breakthrough|news|202\d)\b/i.test(goal) || !requiresCode;

    const tasks = [
        {
            id: 'task_plan',
            role: AGENT_ROLES.PLANNER,
            title: 'Decompose goal & formulate DAG execution plan',
            description: 'Analyzes user requirements and sets criteria for sub-agents.',
            dependencies: [],
            status: TASK_STATUS.PENDING
        }
    ];

    if (requiresSearch) {
        tasks.push({
            id: 'task_research',
            role: AGENT_ROLES.RESEARCHER,
            title: 'Gather domain evidence & factual grounding',
            description: 'Queries live web and references to verify facts and benchmarks.',
            dependencies: ['task_plan'],
            status: TASK_STATUS.PENDING
        });
    }

    if (requiresCode) {
        tasks.push({
            id: 'task_code',
            role: AGENT_ROLES.CODER,
            title: 'Generate verified code & architecture blueprints',
            description: 'Builds implementation examples with syntax validity and clean types.',
            dependencies: requiresSearch ? ['task_research'] : ['task_plan'],
            status: TASK_STATUS.PENDING
        });
    }

    tasks.push({
        id: 'task_synthesize',
        role: AGENT_ROLES.SYNTHESIZER,
        title: 'Cross-verify evidence & compile executive report',
        description: 'Harmonizes agent findings into a structured, executive-ready response.',
        dependencies: [tasks[tasks.length - 1].id],
        status: TASK_STATUS.PENDING
    });

    return {
        goal,
        createdAt: new Date().toISOString(),
        tasks
    };
}

export function createAgentOrchestrator(options = {}) {
    let currentDag = null;
    let isAborted = false;

    return {
        getDag() {
            return currentDag;
        },
        abort() {
            isAborted = true;
        },
        async runWorkflow(userGoal, executorFn = null) {
            isAborted = false;
            currentDag = buildAgentWorkflowDag(userGoal);

            if (typeof options.onWorkflowStart === 'function') {
                options.onWorkflowStart(currentDag);
            }

            const taskOutputs = {};

            for (const task of currentDag.tasks) {
                if (isAborted) {
                    task.status = TASK_STATUS.SKIPPED;
                    if (typeof options.onTaskUpdate === 'function') {
                        options.onTaskUpdate(task);
                    }
                    continue;
                }

                // Check dependencies
                const unmet = task.dependencies.some(depId => {
                    const dep = currentDag.tasks.find(t => t.id === depId);
                    return !dep || dep.status !== TASK_STATUS.COMPLETED;
                });

                if (unmet) {
                    task.status = TASK_STATUS.FAILED;
                    task.error = 'Unmet task dependencies.';
                    if (typeof options.onTaskUpdate === 'function') {
                        options.onTaskUpdate(task);
                    }
                    continue;
                }

                task.status = TASK_STATUS.RUNNING;
                task.startedAt = new Date().toISOString();
                if (typeof options.onTaskUpdate === 'function') {
                    options.onTaskUpdate(task);
                }

                try {
                    let output = '';
                    if (typeof executorFn === 'function') {
                        output = await executorFn(task, taskOutputs, currentDag.goal);
                    } else {
                        output = `Agent ${task.role} completed step for: ${task.title}`;
                    }

                    task.status = TASK_STATUS.COMPLETED;
                    task.completedAt = new Date().toISOString();
                    task.output = output;
                    taskOutputs[task.id] = output;
                } catch (err) {
                    task.status = TASK_STATUS.FAILED;
                    task.error = String(err?.message || err || 'Task execution failed.');
                }

                if (typeof options.onTaskUpdate === 'function') {
                    options.onTaskUpdate(task);
                }
            }

            const workflowResult = {
                dag: currentDag,
                outputs: taskOutputs,
                completed: currentDag.tasks.every(t => t.status === TASK_STATUS.COMPLETED)
            };

            if (typeof options.onWorkflowComplete === 'function') {
                options.onWorkflowComplete(workflowResult);
            }

            return workflowResult;
        }
    };
}
