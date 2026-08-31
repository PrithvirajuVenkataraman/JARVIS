// ThinkingStatus – a lightweight UI helper that renders real‑time pipeline progress.
// Usage: const thinking = new ThinkingStatus(); thinking.update(taskId, status);
export class ThinkingStatus {
  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'thinking-status';
    const root = document.querySelector('#chat-root') || document.body;
    root.prepend(this.container);
    this.stepMap = {
      classifier: 'Understanding the question…',
      entity_extractor: 'Extracting key entities…',
      targeted_queries: 'Formulating targeted queries…',
      multi_source_scrapers: 'Gathering information from multiple sources…',
      evidence_verification: 'Verifying evidence across sources…',
      answer_synthesis: 'Synthesising the final answer…',
    };
    this.rendered = {};
  }

  /** Update UI when a task changes state */
  update(taskId, status) {
    const message = this.stepMap[taskId] || taskId;
    if (status === 'running') {
      if (!this.rendered[taskId]) {
        const el = document.createElement('div');
        el.className = 'thinking-step active';
        el.textContent = message;
        this.container.appendChild(el);
        this.rendered[taskId] = el;
      }
    } else if (status === 'completed') {
      const el = this.rendered[taskId];
      if (el) el.classList.add('completed');
    }
  }

  /** Clear all steps – called after final answer */
  clear() {
    this.container.innerHTML = '';
    this.rendered = {};
  }
}
