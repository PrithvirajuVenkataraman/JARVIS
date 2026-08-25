/**
 * Multi-Agent Workflow Engine (DAG Task Orchestration)
 * Coordinates 4 specialized agents: Planner, Researcher, Coder, and Synthesizer.
 */

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
    const requiresCode = /\b(?:code|script|function|app|config|implement|class|component|api|html|python|javascript|ts|css)\b/i.test(goal);
    const requiresSearch = /\b(?:latest|current|recent|compare|review|market|pricing|vs|best|trends?|breakthrough|news|202\d)\b/i.test(goal) || !requiresCode;

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
            options.onWorkflowStart?.(currentDag);

            const taskOutputs = {};

            for (const task of currentDag.tasks) {
                if (isAborted) {
                    task.status = TASK_STATUS.SKIPPED;
                    continue;
                }

                // Verify dependencies
                const depsMet = task.dependencies.every(d => taskOutputs[d] != null);
                if (!depsMet) {
                    task.status = TASK_STATUS.FAILED;
                    options.onTaskUpdate?.(task, currentDag);
                    continue;
                }

                task.status = TASK_STATUS.RUNNING;
                options.onTaskUpdate?.(task, currentDag);

                try {
                    let output = '';
                    if (typeof executorFn === 'function') {
                        output = await executorFn(task, taskOutputs, currentDag.goal);
                    } else {
                        // Default simulated runner for instant deterministic pass
                        await new Promise(r => setTimeout(r, 60));
                        output = `Verified step output for [${task.title}]`;
                    }
                    taskOutputs[task.id] = output;
                    task.status = TASK_STATUS.COMPLETED;
                    task.output = output;
                    options.onTaskUpdate?.(task, currentDag);
                } catch (err) {
                    task.status = TASK_STATUS.FAILED;
                    task.error = String(err?.message || err);
                    options.onTaskUpdate?.(task, currentDag);
                    options.onError?.(err, task);
                    break;
                }
            }

            const finalResult = taskOutputs['task_synthesize'] || Object.values(taskOutputs).pop() || 'Workflow finished.';
            options.onWorkflowComplete?.(finalResult, currentDag);
            return {
                dag: currentDag,
                result: finalResult,
                outputs: taskOutputs
            };
        }
    };
}
