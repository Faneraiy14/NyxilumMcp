import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { nyxilumReplStart, nyxilumReplEval, nyxilumReplStop } from '../src/tools.js';

async function countTempDirs() {
    const entries = await readdir(tmpdir()).catch(() => []);
    return entries.filter((e) => e.startsWith('nyxilummcp-repl-')).length;
}

test('nyxilum_repl: var/func лишаються видимими між викликами в тій самій сесії', async () => {
    const start = await nyxilumReplStart();
    assert.equal(start.success, true);
    const { sessionId } = start;
    try {
        await nyxilumReplEval({ session_id: sessionId, code: 'var x = 5' });
        const r = await nyxilumReplEval({ session_id: sessionId, code: 'print(x)' });
        assert.equal(r.success, true);
        assert.match(r.output, /5/);
    } finally {
        await nyxilumReplStop({ session_id: sessionId });
    }
});

test('nyxilum_repl: багаторядковий func {...} сплющується в один рядок і залишається викликаним', async () => {
    const start = await nyxilumReplStart();
    const { sessionId } = start;
    try {
        await nyxilumReplEval({ session_id: sessionId, code: 'func double(n) {\n  return n * 2\n}' });
        const r = await nyxilumReplEval({ session_id: sessionId, code: 'print(double(21))' });
        assert.equal(r.success, true);
        assert.match(r.output, /42/);
    } finally {
        await nyxilumReplStop({ session_id: sessionId });
    }
});

test('nyxilum_repl: легітимний вивід із підрядком "> " не обрізається', async () => {
    const start = await nyxilumReplStart();
    const { sessionId } = start;
    try {
        const r = await nyxilumReplEval({ session_id: sessionId, code: 'print("a > b")' });
        assert.equal(r.success, true);
        assert.match(r.output, /a > b/);
    } finally {
        await nyxilumReplStop({ session_id: sessionId });
    }
});

test('nyxilum_repl: помилка виконання НЕ вбиває сесію - наступний виклик далі працює', async () => {
    const start = await nyxilumReplStart();
    const { sessionId } = start;
    try {
        const errResult = await nyxilumReplEval({ session_id: sessionId, code: 'undeclaredFunctionCall()' });
        assert.equal(errResult.success, true); // сам виклик nyxilum_repl_eval успішний - помилка НАЛЕЖИТЬ виводу коду
        assert.match(errResult.output, /Error/);

        const stillAlive = await nyxilumReplEval({ session_id: sessionId, code: 'print("живий")' });
        assert.equal(stillAlive.success, true);
        assert.match(stillAlive.output, /живий/);
    } finally {
        await nyxilumReplStop({ session_id: sessionId });
    }
});

test('nyxilum_repl: дві незалежні сесії не бачать змінних одна одної', async () => {
    const s1 = await nyxilumReplStart();
    const s2 = await nyxilumReplStart();
    try {
        await nyxilumReplEval({ session_id: s1.sessionId, code: 'var onlyInS1 = 999' });
        const r = await nyxilumReplEval({ session_id: s2.sessionId, code: 'print(onlyInS1)' });
        assert.equal(r.success, true);
        assert.match(r.output, /Error/); // "Змінна 'onlyInS1' не оголошена" - ізоляція підтверджена
    } finally {
        await nyxilumReplStop({ session_id: s1.sessionId });
        await nyxilumReplStop({ session_id: s2.sessionId });
    }
});

test('nyxilum_repl: нескінченний цикл ловиться timeout_ms і завершує сесію', async () => {
    const start = await nyxilumReplStart();
    const { sessionId } = start;
    const r = await nyxilumReplEval({ session_id: sessionId, code: 'while true { }', timeout_ms: 1500 });
    assert.equal(r.success, false);
    assert.equal(r.sessionKilled, true);

    // Сесія вже мертва - повторний виклик має дати чітку помилку, не зависання.
    const after = await nyxilumReplEval({ session_id: sessionId, code: 'print(1)' });
    assert.equal(after.success, false);
});

test('nyxilum_repl: невідома сесія дає чітку помилку, не крах', async () => {
    const r = await nyxilumReplEval({ session_id: 'не-існує-такого-id', code: 'print(1)' });
    assert.equal(r.success, false);
    assert.match(r.error, /не знайдено/);
});

test('nyxilum_repl: немає витоку тимчасових директорій після start/stop', async () => {
    const before = await countTempDirs();
    for (let i = 0; i < 3; i++) {
        const s = await nyxilumReplStart();
        await nyxilumReplEval({ session_id: s.sessionId, code: `print(${i})` });
        await nyxilumReplStop({ session_id: s.sessionId });
    }
    const after = await countTempDirs();
    assert.equal(after, before, `лишились тимчасові директорії REPL-сесій: було ${before}, стало ${after}`);
});
