export function render(row, verification) {
    row.querySelector('.answer-verification')?.remove();
    if (!verification?.checks?.length) return;
    const details = document.createElement('details'); details.className = 'answer-verification';
    const summary = document.createElement('summary');
    summary.textContent = verification.status === 'failed' ? 'Arithmetic check found a mismatch' : 'Arithmetic checks passed';
    const scope = document.createElement('p'); scope.textContent = 'Checks cover supported arithmetic equalities only. They do not verify the entire solution or proof.';
    details.append(summary, scope);
    (row.querySelector('.chat-bubble-assistant') || row).append(details);
}
