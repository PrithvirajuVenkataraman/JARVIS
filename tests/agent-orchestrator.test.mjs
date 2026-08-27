import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    AGENT_ROLES,
    TASK_STATUS,
    isComplexAgentGoal,
    cleanAgentPrompt,
    buildAgentWorkflowDag,
    createAgentOrchestrator
} from '../app/agent-orchestrator.js';

describe('Multi-Agent Workflow & DAG Orchestration Suite', () => {
    describe('1. Goal & Intent Detection', () => {
        it('1.1 Recognizes /agent and /workflow slash commands', () => {
            assert.equal(isComplexAgentGoal('/agent Build a quantum simulation in Python and explain the results'), true);
            assert.equal(isComplexAgentGoal('/workflow Compare AWS Lambda vs Cloud Run for latency'), true);
            assert.equal(cleanAgentPrompt('/agent Build an app'), 'Build an app');
        });

        it('1.2 Recognizes multi-faceted complex goals without explicit slash command', () => {
            const complex = 'Please research and analyze recent breakthrough quantum algorithms, compare top 3 approaches with a matrix, and write a full implementation script in Python.';
            assert.equal(isComplexAgentGoal(complex), true);

            const simple = 'What time is it in Tokyo?';
            assert.equal(isComplexAgentGoal(simple), false);
        });
    });

    describe('2. DAG Task Generation', () => {
        it('2.1 Generates 4-agent parallel DAG with concurrent branches', () => {
            const goal = 'Research the best vector databases for Node.js, write sample code, and compile a report.';
            const dag = buildAgentWorkflowDag(goal, { parallel: true });

            assert.equal(dag.goal, goal);
            assert.ok(dag.tasks.length >= 3);

            const plannerTask = dag.tasks.find(t => t.role === AGENT_ROLES.PLANNER);
            const researchTask = dag.tasks.find(t => t.role === AGENT_ROLES.RESEARCHER);
            const coderTask = dag.tasks.find(t => t.role === AGENT_ROLES.CODER);
            const synthTask = dag.tasks.find(t => t.role === AGENT_ROLES.SYNTHESIZER);

            assert.ok(plannerTask, 'Planner task exists');
            assert.ok(researchTask, 'Researcher task exists');
            assert.ok(coderTask, 'Coder task exists');
            assert.ok(synthTask, 'Synthesizer task exists');

            // Verify parallel dependency chain: Researcher & Coder can execute concurrently
            assert.deepEqual(plannerTask.dependencies, []);
            assert.deepEqual(researchTask.dependencies, ['task_plan']);
            assert.deepEqual(coderTask.dependencies, ['task_plan']);
            assert.ok(synthTask.dependencies.includes('task_research'));
            assert.ok(synthTask.dependencies.includes('task_code'));
        });
    });

    describe('3. Orchestration & Execution Flow', () => {
        it('3.1 Executes DAG tasks concurrently in parallel and reports step status updates', async () => {
            const events = [];
            const orchestrator = createAgentOrchestrator({
                onWorkflowStart(dag) {
                    events.push({ type: 'start', taskCount: dag.tasks.length });
                },
                onTaskUpdate(task) {
                    events.push({ type: 'task_update', taskId: task.id, status: task.status });
                },
                onWorkflowComplete(result) {
                    events.push({ type: 'complete', result });
                }
            });

            const result = await orchestrator.runWorkflow(
                'Build a full benchmark of SQLite vs IndexedDB in TypeScript',
                async (task, previousOutputs, goal) => {
                    await new Promise(r => setTimeout(r, 10));
                    return `Simulated output for ${task.role}`;
                }
            );

            assert.ok(result.dag);
            assert.ok(result.outputs['task_plan']);
            assert.ok(result.outputs['task_synthesize']);
            assert.equal(result.dag.tasks.every(t => t.status === TASK_STATUS.COMPLETED), true);

            // Verify lifecycle event stream
            assert.ok(events.some(e => e.type === 'start'));
            assert.ok(events.some(e => e.type === 'task_update' && e.status === TASK_STATUS.RUNNING));
            assert.ok(events.some(e => e.type === 'task_update' && e.status === TASK_STATUS.COMPLETED));
            assert.ok(events.some(e => e.type === 'complete'));
        });

        it('3.2 Gracefully degrades when an intermediate parallel sub-task fails', async () => {
            const orchestrator = createAgentOrchestrator();

            const result = await orchestrator.runWorkflow(
                'Research quantum computing and write Python script',
                async (task) => {
                    if (task.id === 'task_research') {
                        throw new Error('Web search network timeout.');
                    }
                    return `Output for ${task.role}`;
                }
            );

            const researchTask = result.dag.tasks.find(t => t.id === 'task_research');
            const coderTask = result.dag.tasks.find(t => t.id === 'task_code');
            const synthTask = result.dag.tasks.find(t => t.id === 'task_synthesize');

            assert.equal(researchTask.status, TASK_STATUS.FAILED);
            assert.equal(coderTask.status, TASK_STATUS.COMPLETED);
            assert.equal(synthTask.status, TASK_STATUS.COMPLETED, 'Synthesizer must complete using remaining outputs');
        });
    });
});
