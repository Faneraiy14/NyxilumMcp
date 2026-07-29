import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { arxlangRun, arxlangLint, arxlangDocs, arxlangVersion } from '../src/tools.js';

async function countTempDirs() {
    const entries = await readdir(tmpdir()).catch(() => []);
    return entries.filter((e) => e.startsWith('arxmcp-')).length;
}

test('arxlang_run: hello world виконується успішно', async () => {
    const result = await arxlangRun({ code: 'func main() { print("hello") }' });
    assert.equal(result.success, true);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /hello/);
});

test('arxlang_run: необроблений throw дає Runtime Error у STDOUT, exitCode=1', async () => {
    const result = await arxlangRun({ code: 'func main() { throw "боом" }' });
    assert.equal(result.success, false);
    assert.equal(result.exitCode, 1);
    assert.match(result.stdout, /Runtime Error/);
    assert.equal(result.stderr, '');
});

test('arxlang_run: нескінченний цикл без виділень зупиняється таймаутом', async () => {
    const result = await arxlangRun({ code: 'func main() { while true { } }', timeout_ms: 1000 });
    assert.equal(result.timedOut, true);
    assert.equal(result.success, false);
    assert.ok(result.durationMs < 3000, `мало завершитись швидко після timeout, було ${result.durationMs}мс`);
});

test('arxlang_run: gc_max_objects ловить цикл виділень до вичерпання пам\'яті', async () => {
    const result = await arxlangRun({
        code: 'struct P { n: i32 }\nfunc main() { var i = 0\n while i < 100000 { var p = P { n: i }\n i = i + 1 } }',
        gc_max_objects: 100,
        timeout_ms: 10000,
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.stdout, /GC ліміт|Runtime Error/);
});

test('arxlang_run: великий вивід обрізається (truncated), відповідь обмежена', async () => {
    const result = await arxlangRun({
        code: 'func main() { var i = 0\n while i < 20000 { print("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")\n i = i + 1 } }',
        timeout_ms: 15000,
    });
    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(result.stdout, 'utf8') < 40 * 1024);
});

test('arxlang_run: код із shell-метасимволами виконується як текст, не як команда', async () => {
    const result = await arxlangRun({ code: 'func main() { print("$(whoami) & calc.exe ; rm -rf /") }' });
    assert.equal(result.success, true);
    assert.match(result.stdout, /\$\(whoami\)/);
});

test('arxlang_lint: завжди exitCode=0, навіть на кострубатому коді', async () => {
    const result = await arxlangLint({ code: 'func main() {this is not valid arx syntax at all!!!}' });
    assert.equal(result.exitCode, 0);
});

test('arxlang_docs: повертає GUIDE.md цілком', async () => {
    const result = await arxlangDocs({});
    assert.equal(result.success, true);
    assert.match(result.content, /ArxLang/);
});

test('arxlang_docs: фільтрація за секцією', async () => {
    const result = await arxlangDocs({ section: 'Мапи' });
    assert.equal(result.success, true);
    assert.match(result.content, /newMap/);
});

test('arxlang_version: повертає версію ArxNode', async () => {
    const result = await arxlangVersion();
    assert.equal(result.success, true);
    assert.match(result.stdout, /ArxNode/);
});

test('немає витоку тимчасових директорій після серії запусків', async () => {
    const before = await countTempDirs();
    for (let i = 0; i < 10; i++) {
        await arxlangRun({ code: `func main() { print(${i}) }` });
    }
    const after = await countTempDirs();
    assert.equal(after, before, `лишились тимчасові директорії: було ${before}, стало ${after}`);
});
