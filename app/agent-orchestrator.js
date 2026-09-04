/**
 * Multi-Agent Workflow Engine (Concurrent Parallel DAG Task Orchestration)
 * Coordinates 4 specialized agents: Planner, Researcher, Coder, and Synthesizer.
 * Supports concurrent parallel branch execution via dynamic event-driven wave scheduling.
 */
import { isAmbiguous } from './ambiguity.js';
import { computeIntentConfidence, computeEntityConfidence, computeEvidenceConfidence, computeAnswerGroundingConfidence } from './confidence.js';

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

export function buildAgentWorkflowDag(userGoal = '', options = {}) {
    const goal = cleanAgentPrompt(userGoal);
    const goalVec = textToEmbeddingVector(goal);
    const allowParallel = options.parallel !== false;

    const codeSim = vectorCosineSimilarity(goalVec, CODE_TASK_VECTOR);
    const researchSim = vectorCosineSimilarity(goalVec, RESEARCH_TASK_VECTOR);

    const requiresCode = codeSim >= 0.16 || /\b(?:code|script|function|app|config|implement|class|component|api|html|python|javascript|ts|css)\b/i.test(goal);
    const requiresSearch = researchSim >= 0.16 || /\b(?:research|investigate|search|find|latest|current|recent|compare|review|market|pricing|vs|best|trends?|breakthrough|news|202\d)\b/i.test(goal) || !requiresCode;

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

    const parallelBranchIds = [];

    if (requiresSearch) {
        tasks.push({
            id: 'task_research',
            role: AGENT_ROLES.RESEARCHER,
            title: 'Gather domain evidence & factual grounding',
            description: 'Queries live web and references to verify facts and benchmarks.',
            dependencies: ['task_plan'],
            status: TASK_STATUS.PENDING
        });
        parallelBranchIds.push('task_research');
    }

    if (requiresCode) {
        tasks.push({
            id: 'task_code',
            role: AGENT_ROLES.CODER,
            title: 'Generate verified code & architecture blueprints',
            description: 'Builds implementation examples with syntax validity and clean types.',
            dependencies: allowParallel ? ['task_plan'] : (requiresSearch ? ['task_research'] : ['task_plan']),
            status: TASK_STATUS.PENDING
        });
        parallelBranchIds.push('task_code');
    }

    tasks.push({
        id: 'task_synthesize',
        role: AGENT_ROLES.SYNTHESIZER,
        title: 'Cross-verify evidence & compile executive report',
        description: 'Harmonizes agent findings into a structured, executive-ready response.',
        dependencies: allowParallel ? (parallelBranchIds.length > 0 ? parallelBranchIds : ['task_plan']) : [tasks[tasks.length - 1].id],
        status: TASK_STATUS.PENDING
    });

    return {
        goal,
        parallel: allowParallel,
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
            currentDag = buildAgentWorkflowDag(userGoal, options);

            // Detect ambiguous query before proceeding
            if (isAmbiguous(userGoal)) {
                // Notify caller that clarification is needed
                if (typeof options.onClarification === 'function') {
                    options.onClarification('Your question appears ambiguous. Please provide more details.');
                }
                // Abort workflow early
                return { dag: currentDag, outputs: {}, completed: false, ambiguous: true };
            }
            
            // Initialize ThinkingStatus UI (browser only) and wrap task updates
            let thinkingStatus = null;
            if (typeof window !== 'undefined') {
                import('./thinking-status.js').then(({ ThinkingStatus }) => {
                    thinkingStatus = new ThinkingStatus();
                });
            }
            const originalOnTaskUpdate = options.onTaskUpdate;
            const wrappedOnTaskUpdate = (task) => {
                if (typeof originalOnTaskUpdate === 'function') originalOnTaskUpdate(task);
                if (thinkingStatus) {
                    const uiTaskId = task.id.replace(/^task_/, ''); // e.g., task_plan -> plan
                    thinkingStatus.update(uiTaskId, task.status);
                    if (uiTaskId === 'synthesize' && task.status === TASK_STATUS.COMPLETED) {
                        setTimeout(() => thinkingStatus.clear(), 500);
                    }
                }
            };
            options.onTaskUpdate = wrappedOnTaskUpdate;
            if (typeof options.onWorkflowStart === 'function') {
                options.onWorkflowStart(currentDag);
            }

            const taskOutputs = {};
            const activePromises = new Map();
            const pendingTasks = new Set(currentDag.tasks);

            while (pendingTasks.size > 0 && !isAborted) {
                // Find all tasks whose dependencies are satisfied
                const readyTasks = Array.from(pendingTasks).filter(task => {
                    if (activePromises.has(task.id)) return false;
                    return task.dependencies.every(depId => {
                        const dep = currentDag.tasks.find(t => t.id === depId);
                        return dep && (dep.status === TASK_STATUS.COMPLETED || dep.status === TASK_STATUS.FAILED);
                    });
                });

                if (readyTasks.length === 0 && activePromises.size === 0) {
                    // Deadlock or unmet dependencies
                    for (const task of pendingTasks) {
                        task.status = TASK_STATUS.FAILED;
                        task.error = 'Unresolvable task dependencies.';
                        if (typeof options.onTaskUpdate === 'function') options.onTaskUpdate(task);
                    }
                    break;
                }

                // Dispatch all ready tasks in parallel concurrently!
                for (const task of readyTasks) {
                    if (isAborted) {
                        task.status = TASK_STATUS.SKIPPED;
                        pendingTasks.delete(task);
                        if (typeof options.onTaskUpdate === 'function') options.onTaskUpdate(task);
                        continue;
                    }

                    const hasFailedDeps = task.dependencies.some(depId => {
                        const dep = currentDag.tasks.find(t => t.id === depId);
                        return dep && dep.status === TASK_STATUS.FAILED;
                    });

                    // Graceful degradation: synthesizer still proceeds with partial outputs
                    if (hasFailedDeps && task.role !== AGENT_ROLES.SYNTHESIZER) {
                        task.status = TASK_STATUS.FAILED;
                        task.error = 'Prerequisite dependency failed.';
                        pendingTasks.delete(task);
                        if (typeof options.onTaskUpdate === 'function') options.onTaskUpdate(task);
                        continue;
                    }

                    task.status = TASK_STATUS.RUNNING;
                    task.startedAt = new Date().toISOString();
                    if (typeof options.onTaskUpdate === 'function') {
                        options.onTaskUpdate(task);
                    }

                    const taskPromise = (async () => {
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

                        pendingTasks.delete(task);
                        activePromises.delete(task.id);
                    })();

                    activePromises.set(task.id, taskPromise);
                }

                // Wait for at least one in-flight task to complete before advancing the wave loop
                if (activePromises.size > 0) {
                    await Promise.race(activePromises.values());
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
