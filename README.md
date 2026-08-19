# nyxilum-mcp

MCP-сервер, що дозволяє AI-асистенту (Claude, Cursor тощо) напряму
компілювати/запускати/лінтити/форматувати NyxilumLang (`.nx`) код через
[NyxilumNode](https://github.com/Faneraiy14/NyxilumNode) — без ручного
`dotnet run`/copy-paste в термінал.

## Навіщо окремий репозиторій, а не частина NyxilumLang

`node_modules` цього проєкту не мав би потрапляти в dotnet-збірку чи
`publish/` NyxilumLang. Живе поруч, як сестринський проєкт.

## Встановлення

```bash
git clone https://github.com/Faneraiy14/NyxilumMcp.git
cd NyxilumMcp
npm install
```

Потрібен зібраний NyxilumNode поруч (`../NyxilumLang` за замовчуванням,
`dotnet build src/NyxilumLang` там) — або задай шлях явно:

```bash
# Linux/Mac
export NX_NODE_PATH=/шлях/до/NyxilumLang   # .exe на Windows, .dll — тоді запускається через `dotnet`
# або
export NX_ECOSYSTEM_ROOT=/шлях/до/NyxilumLang
```

```powershell
# Windows
$env:NX_NODE_PATH = "C:\шлях\до\NyxilumLang.exe"
# або
$env:NX_ECOSYSTEM_ROOT = "C:\шлях\до\NyxilumLang"
```

## Підключення (Claude Desktop / Claude Code)

```json
{
  "mcpServers": {
    "nyxilum": {
      "command": "node",
      "args": ["/шлях/до/NyxilumMcp/src/server.js"]
    }
  }
}
```

## Інструменти

| Інструмент | Що робить |
|---|---|
| `nyxilum_run` | Компілює й виконує код у пісочниці (окремий процес, timeout, ліміт GC-виділень) |
| `nyxilum_check` | Лише лексер+парсер — перевіряє синтаксис БЕЗ виконання коду (дешевше й безпечніше за `nyxilum_run` для незавершеного коду) |
| `nyxilum_lint` | Стильові попередження (довжина рядка, порожні блоки) — **не** перевірка синтаксису, завжди exitCode=0 |
| `nyxilum_format` | Форматує код |
| `nyxilum_version` | Версія знайденого NyxilumNode — заодно health check |
| `nyxilum_docs` | GUIDE.md цілком або конкретна секція (`### `-заголовок) за назвою |

## Безпека виконання (`nyxilum_run`)

- Код НІКОЛИ не потрапляє в shell/argv як текст — завжди пишеться у
  власний тимчасовий файл, шлях до якого передається як звичайний
  аргумент процесу (`execFile`, без `shell: true`).
- Процесний `timeout` (типово 10с, максимум 60с) — єдиний реальний
  захист від `while (true) {}` без виділень пам'яті: `NX_GC_MAX_OBJECTS`
  рахує лише NyxilumLang-виділення (масиви/структури/мапи), а не ітерації
  циклу самі по собі.
- `env` — allowlist (`PATH`, `SystemRoot`, `TEMP`, `DOTNET_ROOT` тощо),
  не весь `process.env` цього серверного процесу.
- `NX_SANDBOX=1` (фіксовано, не залежить від вхідних аргументів
  інструмента) — файловий I/O обмежується тимчасовою текою запуску,
  мережа (`httpGet`/`httpServer`/`wsConnect` тощо) й читання змінних
  середовища (`osEnv`) повністю заборонені. Потребує NyxilumNode з
  підтримкою `NX_SANDBOX` (див. [NyxilumLang README](https://github.com/Faneraiy14/NyxilumLang#пісочниця-для-ненадійного-коду));
  зі старішим бінарником прапорець просто ігнорується.
- Вивід (`stdout`/`stderr`) обрізається до 32 КБ на потік — цикл, що
  друкує мільйони рядків, не заповнить контекст відповіді.
- Тимчасова тека видаляється в `finally` завжди, навіть при таймауті.

`RunFile` в Nx.cs пише `Runtime Error:`/`Parse Error:` у **stdout**
(не stderr) і завершується з `exitCode=1` — це поведінка самого
NyxilumNode, не цього сервера; кожен інструмент явно зазначає це в описі.

## Тести

```bash
npm test
```

18 перевірок: `smoke.mjs` викликає обробники напряму (успішний запуск,
необроблений `throw`, таймаут нескінченного циклу, `gc_max_objects`,
обрізання великого виводу, стійкість до shell-метасимволів у коді,
`nyxilum_check` (проходить/ловить синтаксичну помилку/НЕ виконує код),
відсутність витоку тимчасових директорій), `transport.mjs` — те саме
через РЕАЛЬНИЙ MCP-протокол (`StdioClientTransport` + `Client`), не
лише прямі виклики функцій.

## Ліцензія

MIT — Faneraiy14.
