import assert from 'node:assert/strict';
import {
    AGENTIC_TOOL_DEFINITIONS,
    executeCodeInterpreter,
    executeDatetimeContext,
    executeSessionMemory,
    dispatchToolCall
} from '../app/tool-dispatcher.js';

console.log('--- Testing Agentic Tool Dispatcher ---');

// 1. Tool Definitions schema validation
assert.ok(Array.isArray(AGENTIC_TOOL_DEFINITIONS));
assert.equal(AGENTIC_TOOL_DEFINITIONS.length, 5);
const toolNames = AGENTIC_TOOL_DEFINITIONS.map(t => t.function.name);
assert.ok(toolNames.includes('code_interpreter'));
assert.ok(toolNames.includes('knowledge_lookup'));
assert.ok(toolNames.includes('datetime_context'));
assert.ok(toolNames.includes('session_memory'));
assert.ok(toolNames.includes('generate_image'));

// 2. Code Interpreter
const mathRes = executeCodeInterpreter('Math.sqrt(144) + 8 * 2');
assert.equal(mathRes.success, true);
assert.equal(mathRes.result, '28');

const errorRes = executeCodeInterpreter('nonExistentVariable.map(x => x)');
assert.equal(errorRes.success, false);
assert.ok(typeof errorRes.error === 'string');

// 3. Datetime Context
const dtRes = executeDatetimeContext('UTC');
assert.equal(dtRes.success, true);
assert.ok(dtRes.data?.formatted);
assert.equal(dtRes.data?.timezone, 'UTC');

// 4. Session Memory Search
const mockHistory = [
    { role: 'user', content: 'We need to analyze quarterly revenue projection.' },
    { role: 'assistant', content: 'Revenue projection is set to $1.2M.' }
];
const mockAttachments = [
    { name: 'budget_sheet.csv', text: 'Department expenses and operational allocation report' }
];

const memRes = executeSessionMemory('revenue projection', mockHistory, mockAttachments);
assert.equal(memRes.success, true);
assert.ok(memRes.matches.length >= 1);

// 5. Main Dispatcher Call
const dispatchRes = await dispatchToolCall('code_interpreter', { code: '2 + 2' });
assert.equal(dispatchRes.tool, 'code_interpreter');
assert.equal(dispatchRes.success, true);
assert.equal(dispatchRes.output, '4');

console.log('tool-dispatcher-tests-ok');
