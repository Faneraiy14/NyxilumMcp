// repl.js — довготривала REPL-сесія NyxilumLang: на відміну від
// nyxilum_run (окремий процес на КОЖЕН виклик, без пам'яті між ними),
// тут один процес `nx` (без файлового аргументу — REPL-режим) живе
// між кількома викликами nyxilum_repl_eval, тож var/func з попереднього
// виклику лишаються видимими в наступному — та сама персистентність,
// яку тестує tests/run_all.sh у самому NyxilumLang ("REPL — var і func
// зберігаються між рядками").
//
// Той самий принцип пісочниці, що й у run.js (NX_SANDBOX=1 завжди,
// баз env-allowlist, cwd — власна тимчасова тека) — сесія тут ЖИВЕ
// довше за один виклик, тож ризик від AI-згенерованого коду не менший,
// а більший (більше можливостей щось накопичити/зациклити), не менший.
//
// ПРОТОКОЛ ЧИТАННЯ ВІДПОВІДІ (чому не просто "почекати трохи і прочитати
// stdout"): REPL друкує запрошення "> " (БЕЗ символу нового рядка) перед
// кожним ReadLine() і не позначає кінець відповіді жодним чином — з
// потоку stdout неможливо надійно визначити "виконання цього рядка
// завершилось" лише за паузою (повільний код чи мережевий виклик
// всередині рядка виглядав би так само, як "уже все"). Рішення:
// відразу після коду користувача пишемо ДРУГИЙ рядок — print()
// унікального одноразового маркера (128-бітний випадковий hex,
// зіткнення з реальним виводом коду практично неможливе) — і читаємо
// stdout, поки в накопиченому буфері не з'явиться цей маркер. Усе ПЕРЕД
// маркером, мінус останні 2 байти (запрошення "> " перед рядком з
// маркером, яке printMarker() гарантовано друкує прямо перед своїм
// власним виводом) — і є чистий вивід коду користувача. Обрізаємо
// рівно ОСТАННІ 2 символи як суфікс (не global replace по всьому
// тексту!) — саме тому легітимний вивід на кшталт print("a > b")
// лишається недоторканим: прибирається лише те єдине запрошення, яке
// структурно завжди стоїть прямо перед друком маркера, а не будь-яке
// входження підрядка "> " деінде в тексті.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolveNyxilumNode } from './locate.js';
import { truncateUtf8 } from './text-truncate.js';

const MAX_OUTPUT_BYTES = 32 * 1024;
const ENV_ALLOWLIST = ['SystemRoot', 'PATH', 'Path', 'TEMP', 'TMP', 'ProgramFiles', 'ProgramFiles(x86)', 'DOTNET_ROOT'];
const MAX_SESSIONS = 5;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const STARTUP_TIMEOUT_MS = 10_000;

function baseEnv() {
    const env = {};
    for (const key of ENV_ALLOWLIST) {
        if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    return env;
}

/** @type {Map<string, Session>} */
const sessions = new Map();

class Session {
    constructor(id, child, dir) {
        this.id = id;
        this.child = child;
        this.dir = dir;
        this.buffer = '';
        this.pendingResolvers = []; // { predicate, resolve } — читання стдаута чекає, поки predicate(buffer) не стане true
        this.idleTimer = null;
        this.dead = false;
        this.deadReason = null;

        child.stdout.on('data', (chunk) => {
            this.buffer += chunk.toString('utf8');
            this._checkPending();
        });
        child.on('exit', (code, signal) => {
            this.dead = true;
            this.deadReason = signal ? `процес завершився за сигналом ${signal}` : `процес завершився з кодом ${code}`;
            this._checkPending(); // будь-хто, хто чекає на щось, отримає помилку негайно, а не зависне назавжди
        });
        child.on('error', (err) => {
            this.dead = true;
            this.deadReason = `помилка процесу: ${err.message}`;
            this._checkPending();
        });

        this._resetIdleTimer();
    }

    _resetIdleTimer() {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => {
            stopSession(this.id, 'idle-timeout').catch(() => {});
        }, IDLE_TIMEOUT_MS);
        this.idleTimer.unref?.();
    }

    _checkPending() {
        const still = [];
        for (const p of this.pendingResolvers) {
            if (this.dead) {
                p.reject(new Error(this.deadReason ?? 'сесія завершилась несподівано'));
                continue;
            }
            if (p.predicate(this.buffer)) {
                p.resolve();
            } else {
                still.push(p);
            }
        }
        this.pendingResolvers = still;
    }

    /** Чекає, поки predicate(this.buffer) не стане true, або timeoutMs, або смерть процесу. */
    waitFor(predicate, timeoutMs) {
        if (predicate(this.buffer)) return Promise.resolve();
        if (this.dead) return Promise.reject(new Error(this.deadReason ?? 'сесія вже завершена'));
        return new Promise((resolve, reject) => {
            const entry = { predicate, resolve, reject };
            this.pendingResolvers.push(entry);
            const timer = setTimeout(() => {
                this.pendingResolvers = this.pendingResolvers.filter((p) => p !== entry);
                reject(new TimeoutError());
            }, timeoutMs);
            timer.unref?.();
            const wrappedResolve = () => { clearTimeout(timer); resolve(); };
            const wrappedReject = (e) => { clearTimeout(timer); reject(e); };
            entry.resolve = wrappedResolve;
            entry.reject = wrappedReject;
        });
    }
}

class TimeoutError extends Error {
    constructor() { super('timeout'); this.name = 'TimeoutError'; }
}

export function listSessions() {
    return [...sessions.keys()];
}

export async function startReplSession() {
    if (sessions.size >= MAX_SESSIONS) {
        return { success: false, error: `Забагато відкритих REPL-сесій (максимум ${MAX_SESSIONS}). Заверши якусь через nyxilum_repl_stop перед новою.` };
    }

    const { cmd, preArgs } = resolveNyxilumNode();
    const dir = await mkdtemp(join(tmpdir(), 'nyxilummcp-repl-'));
    const id = randomUUID();

    const child = spawn(cmd, [...preArgs], {
        cwd: dir,
        env: { ...baseEnv(), NX_SANDBOX: '1' },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    const session = new Session(id, child, dir);
    sessions.set(id, session);

    try {
        // Стартовий банер + перше запрошення "> " — чекаємо, поки з'явиться,
        // і повністю ВІДКИДАЄМО (не потрібен викликачу), щоб буфер стартував
        // з чистого стану перед першим reply.
        await session.waitFor((buf) => buf.includes('> '), STARTUP_TIMEOUT_MS);
        session.buffer = '';
        return { success: true, sessionId: id };
    } catch (err) {
        await stopSession(id, 'startup-failed').catch(() => {});
        const stderrTail = truncateUtf8(session.stderrTail ?? '', 2048).text;
        return {
            success: false,
            error: err instanceof TimeoutError
                ? 'NyxilumNode не відповів запрошенням REPL за відведений час.'
                : `Не вдалось запустити REPL-сесію: ${err.message}`,
            stderr: stderrTail || undefined,
        };
    }
}

export async function evalInSession(sessionId, code, timeoutMs = 10_000) {
    const session = sessions.get(sessionId);
    if (!session) {
        return { success: false, error: `Сесію "${sessionId}" не знайдено (вже завершена або ніколи не існувала). Виклич nyxilum_repl_start.` };
    }
    if (session.dead) {
        sessions.delete(sessionId);
        return { success: false, error: `Сесія завершена: ${session.deadReason}` };
    }

    session._resetIdleTimer();

    // Реальні переноси рядків усередині code НЕ підтримуються REPL'ом
    // напряму: він читає stdin рядок за рядком (Console.ReadLine), тож
    // багаторядковий func { ... } зламався б на першому "\n" (перевірено
    // живцем — "Очікується '}' на рядку 1"). Замінюємо на пробіл, що для
    // цієї мови синтаксично незначущий скрізь, КРІМ // -коментарів
    // (документована межа нижче, у description інструмента).
    const flattened = code.replace(/\r?\n/g, ' ').trim();
    if (flattened === '') {
        return { success: true, output: '' };
    }

    const marker = ` NX_REPL_${randomBytes(16).toString('hex')} `;

    session.buffer = ''; // інваріант: на початку кожного eval буфер порожній (кінець попереднього повністю осушено нижче)
    session.child.stdin.write(flattened + '\n');
    session.child.stdin.write(`print("${marker}")\n`);

    try {
        await session.waitFor((buf) => buf.includes(marker), timeoutMs);
    } catch (err) {
        if (err instanceof TimeoutError) {
            // Код у сесії міг зациклитись назавжди - продовжувати чекати
            // сенсу нема, а лишати процес висіти - витік. Вбиваємо сесію
            // одразу, а не лишаємо викликача вважати, що можна спробувати
            // ще раз у тій самій сесії (вона вже недієздатна).
            await stopSession(sessionId, 'eval-timeout').catch(() => {});
            return {
                success: false,
                error: `Виконання не завершилось за ${timeoutMs}мс (можливий нескінченний цикл) - сесію завершено. Почни нову через nyxilum_repl_start.`,
                sessionKilled: true,
            };
        }
        sessions.delete(sessionId);
        return { success: false, error: err.message, sessionKilled: true };
    }

    const idx = session.buffer.indexOf(marker);
    let beforeMarker = session.buffer.slice(0, idx);
    // Запрошення "> " перед рядком print(marker) - структурно завжди
    // рівно тут, суфіксом; прибираємо його ПОЗИЦІЙНО (останні 2 символи),
    // а не глобальним replace, щоб не зачепити легітимний вивід коду,
    // що сам містить підрядок "> ".
    if (beforeMarker.endsWith('> ')) {
        beforeMarker = beforeMarker.slice(0, -2);
    }

    // Дочитуємо "\n> " одразу після маркера (кінець print(marker) і
    // запрошення для НАСТУПНОГО рядка) - без цього наступний eval
    // застав би in-flight байти в буфері і збився б.
    const afterMarkerNeedle = marker + '\n> ';
    try {
        await session.waitFor((buf) => buf.includes(afterMarkerNeedle), timeoutMs);
    } catch {
        await stopSession(sessionId, 'drain-timeout').catch(() => {});
        return {
            success: false,
            error: 'Не вдалось дочитати запрошення після виконання - сесію завершено.',
            sessionKilled: true,
        };
    }
    session.buffer = ''; // повністю осушено - інваріант відновлено для наступного виклику

    const trunc = truncateUtf8(beforeMarker, MAX_OUTPUT_BYTES);
    return { success: true, output: trunc.text, truncated: trunc.truncated };
}

export async function stopSession(sessionId, _reason = 'user-requested') {
    const session = sessions.get(sessionId);
    if (!session) return { success: true, alreadyGone: true };

    sessions.delete(sessionId);
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session._checkPending(); // не лишати "вічно висячі" waitFor-очікування на цю сесію

    if (!session.dead) {
        try {
            session.child.stdin.write('exit()\n');
        } catch { /* канал міг уже закритись — не критично, kill() нижче все одно спрацює */ }
        session.child.kill('SIGTERM');
        // Windows не гарантує graceful SIGTERM для консольних застосунків -
        // короткий грейс-період, потім SIGKILL, якщо процес досі живий.
        setTimeout(() => {
            try { session.child.kill('SIGKILL'); } catch { /* уже мертвий */ }
        }, 2000).unref?.();
    }

    await rm(session.dir, { recursive: true, force: true }).catch(() => {});
    return { success: true };
}
