import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { nyxilumRun, nyxilumLint, nyxilumDocs, nyxilumVersion } from '../src/tools.js';

async function countTempDirs() {
    const entries = await readdir(tmpdir()).catch(() => []);
    return entries.filter((e) => e.startsWith('nyxilummcp-')).length;
}

test('nyxilum_run: hello world виконується успішно', async () => {
    const result = await nyxilumRun({ code: 'func main() { print("hello") }' });
    assert.equal(result.success, true);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /hello/);
});

test('nyxilum_run: необроблений throw дає Runtime Error у STDOUT, exitCode=1', async () => {
    const result = await nyxilumRun({ code: 'func main() { throw "боом" }' });
    assert.equal(result.success, false);
    assert.equal(result.exitCode, 1);
    assert.match(result.stdout, /Runtime Error/);
    assert.equal(result.stderr, '');
});

test('nyxilum_run: нескінченний цикл без виділень зупиняється таймаутом', async () => {
    const result = await nyxilumRun({ code: 'func main() { while true { } }', timeout_ms: 1000 });
    assert.equal(result.timedOut, true);
    assert.equal(result.success, false);
    assert.ok(result.durationMs < 3000, `мало завершитись швидко після timeout, було ${result.durationMs}мс`);
});

test('nyxilum_run: gc_max_objects ловить цикл виділень до вичерпання пам\'яті', async () => {
    const result = await nyxilumRun({
        code: 'struct P { n: i32 }\nfunc main() { var i = 0\n while i < 100000 { var p = P { n: i }\n i = i + 1 } }',
        gc_max_objects: 100,
        timeout_ms: 10000,
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.stdout, /GC ліміт|Runtime Error/);
});

test('nyxilum_run: великий вивід обрізається (truncated), відповідь обмежена', async () => {
    const result = await nyxilumRun({
        code: 'func main() { var i = 0\n while i < 20000 { print("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")\n i = i + 1 } }',
        timeout_ms: 15000,
    });
    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(result.stdout, 'utf8') < 40 * 1024);
});

test('nyxilum_run: код із shell-метасимволами виконується як текст, не як команда', async () => {
    const result = await nyxilumRun({ code: 'func main() { print("$(whoami) & calc.exe ; rm -rf /") }' });
    assert.equal(result.success, true);
    assert.match(result.stdout, /\$\(whoami\)/);
});

test('nyxilum_lint: завжди exitCode=0, навіть на кострубатому коді', async () => {
    const result = await nyxilumLint({ code: 'func main() {this is not valid nx syntax at all!!!}' });
    assert.equal(result.exitCode, 0);
});

test('nyxilum_docs: повертає GUIDE.md цілком', async () => {
    const result = await nyxilumDocs({});
    assert.equal(result.success, true);
    assert.match(result.content, /NyxilumLang/);
});

test('nyxilum_docs: фільтрація за секцією', async () => {
    const result = await nyxilumDocs({ section: 'Мапи' });
    assert.equal(result.success, true);
    assert.match(result.content, /newMap/);
});

test('nyxilum_version: повертає версію NyxilumNode', async () => {
    const result = await nyxilumVersion();
    assert.equal(result.success, true);
    // Бінарник називається "Nx" (AssemblyName), не "NyxilumNode" —
    // той самий поділ "проєкт vs команда", що й у locate.js.
    assert.match(result.stdout, /Nx v\d+\.\d+\.\d+/);
});

test('немає витоку тимчасових директорій після серії запусків', async () => {
    const before = await countTempDirs();
    for (let i = 0; i < 10; i++) {
        await nyxilumRun({ code: `func main() { print(${i}) }` });
    }
    const after = await countTempDirs();
    assert.equal(after, before, `лишились тимчасові директорії: було ${before}, стало ${after}`);
});
