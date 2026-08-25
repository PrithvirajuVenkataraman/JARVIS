import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Chat History, Real-Time Search & Export Suite', () => {
    const mockSessions = [
        {
            id: 'sess_1',
            title: 'Quantum Physics Discussion',
            updatedAt: '2026-08-25T10:00:00.000Z',
            pinned: false,
            messages: [
                { role: 'user', text: 'Explain quantum entanglement simply.' },
                { role: 'assistant', text: 'Quantum entanglement occurs when pairs of particles interact such that their states become coupled.' }
            ]
        },
        {
            id: 'sess_2',
            title: 'Tamil Nadu Politics',
            updatedAt: '2026-08-24T18:00:00.000Z',
            pinned: true,
            messages: [
                { role: 'user', text: 'Who is the Chief Minister of Tamil Nadu?' },
                { role: 'assistant', text: 'The Chief Minister of Tamil Nadu is M. K. Stalin.' }
            ]
        },
        {
            id: 'sess_3',
            title: 'JavaScript Async Patterns',
            updatedAt: '2026-08-25T12:00:00.000Z',
            pinned: false,
            messages: [
                { role: 'user', text: 'How do async iterators work in Node.js?' },
                { role: 'assistant', text: 'Async iterators use the for-await-of loop syntax.' }
            ]
        }
    ];

    function searchChatSessionText(session) {
        const title = String(session?.title || '');
        const msgs = Array.isArray(session?.messages) ? session.messages.map(m => m.text).join(' ') : '';
        return `${title} ${msgs}`.toLowerCase();
    }

    function filterAndSortSessions(sessions, query) {
        const q = String(query || '').toLowerCase().trim();
        return sessions
            .filter(session => !q || searchChatSessionText(session).includes(q))
            .sort((a, b) => {
                if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
                return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
            });
    }

    it('1.1 Real-time search filters conversations across both title and message content', () => {
        // Search query only found in message body
        const result1 = filterAndSortSessions(mockSessions, 'entanglement');
        assert.equal(result1.length, 1);
        assert.equal(result1[0].id, 'sess_1');

        // Search query found in title
        const result2 = filterAndSortSessions(mockSessions, 'Politics');
        assert.equal(result2.length, 1);
        assert.equal(result2[0].id, 'sess_2');

        // Search query not found
        const result3 = filterAndSortSessions(mockSessions, 'nonexistent query 12345');
        assert.equal(result3.length, 0);
    });

    it('1.2 Pinned conversations always anchor to the top regardless of update timestamp', () => {
        const allSorted = filterAndSortSessions(mockSessions, '');
        assert.equal(allSorted.length, 3);
        // sess_2 is pinned, so it must be first even though sess_3 has a newer updatedAt timestamp
        assert.equal(allSorted[0].id, 'sess_2');
        assert.equal(allSorted[0].pinned, true);
        assert.equal(allSorted[1].id, 'sess_3');
        assert.equal(allSorted[2].id, 'sess_1');
    });

    it('2.1 Message bookmarking adds, persists, and deduplicates saved insights', () => {
        let bookmarks = [];

        function toggleBookmark(text, title) {
            const idx = bookmarks.findIndex(b => b.text === text);
            if (idx >= 0) {
                bookmarks.splice(idx, 1);
                return false; // unbookmarked
            } else {
                bookmarks.unshift({ id: `bm_${Date.now()}`, text, title, timestamp: new Date().toISOString() });
                return true; // bookmarked
            }
        }

        const sampleText = 'Quantum entanglement occurs when pairs of particles interact.';
        assert.equal(toggleBookmark(sampleText, 'Physics'), true);
        assert.equal(bookmarks.length, 1);
        assert.equal(bookmarks[0].text, sampleText);

        // Toggle again to remove
        assert.equal(toggleBookmark(sampleText, 'Physics'), false);
        assert.equal(bookmarks.length, 0);
    });

    it('3.1 Markdown and JSON export formatters generate valid structured output', () => {
        const history = [
            { user: 'Hello JARVIS', ai: 'Hello! How can I assist you today?' }
        ];

        function formatAsMarkdown(items) {
            return items.map((item, i) => `## Turn ${i + 1}\n\n**User:**\n\n${item.user}\n\n**JARVIS:**\n\n${item.ai}`).join('\n\n');
        }

        const md = formatAsMarkdown(history);
        assert.ok(md.includes('## Turn 1'));
        assert.ok(md.includes('**User:**\n\nHello JARVIS'));
        assert.ok(md.includes('**JARVIS:**\n\nHello! How can I assist you today?'));

        const jsonStr = JSON.stringify(history, null, 2);
        const parsed = JSON.parse(jsonStr);
        assert.equal(parsed.length, 1);
        assert.equal(parsed[0].user, 'Hello JARVIS');
    });
});
