# arx-mcp

MCP-сервер, що дозволяє AI-асистенту (Claude, Cursor тощо) напряму
компілювати/запускати/лінтити/форматувати ArxLang (`.arx`) код через
[ArxNode](https://github.com/Faneraiy14/ArxLang) — без ручного
`dotnet run`/copy-paste в термінал.

## Навіщо окремий репозиторій, а не частина ArxLang

`node_modules` цього проєкту не мав би потрапляти в dotnet-збірку чи
`publish/` ArxLang. Живе поруч, як сестринський проєкт.

## Встановлення

```bash
git clone https://github.com/Faneraiy14/ArxMcp.git
cd ArxMcp
npm install
```

Потрібен зібраний ArxNode поруч (`../ArxLang` за замовчуванням,
`dotnet build src/ArxLang` там) — або задай шлях явно:

```bash
# Linux/Mac
export ARX_NODE_PATH=/шлях/до/ArxLang   # .exe на Windows, .dll — тоді запускається через `dotnet`
# або
export ARX_ECOSYSTEM_ROOT=/шлях/до/ArxLang
```

```powershell
# Windows
$env:ARX_NODE_PATH = "C:\шлях\до\ArxLang.exe"
# або
$env:ARX_ECOSYSTEM_ROOT = "C:\шлях\до\ArxLang"
```

## Підключення (Claude Desktop / Claude Code)

```json
{
  "mcpServers": {
    "arxlang": {
      "command": "node",
      "args": ["/шлях/до/ArxMcp/src/server.js"]
    }
  }
}
```

## Інструменти

| Інструмент | Що робить |
|---|---|
| `arxlang_run` | Компілює й виконує код у пісочниці (окремий процес, timeout, ліміт GC-виділень) |
| `arxlang_lint` | Стильові попередження (довжина рядка, порожні блоки) — **не** перевірка синтаксису, завжди exitCode=0 |
| `arxlang_format` | Форматує код |
| `arxlang_version` | Версія знайденого ArxNode — заодно health check |
| `arxlang_docs` | GUIDE.md цілком або конкретна секція (`### `-заголовок) за назвою |

## Безпека виконання (`arxlang_run`)

- Код НІКОЛИ не потрапляє в shell/argv як текст — завжди пишеться у
  власний тимчасовий файл, шлях до якого передається як звичайний
  аргумент процесу (`execFile`, без `shell: true`).
- Процесний `timeout` (типово 10с, максимум 60с) — єдиний реальний
  захист від `while (true) {}` без виділень пам'яті: `ARX_GC_MAX_OBJECTS`
  рахує лише ArxLang-виділення (масиви/структури/мапи), а не ітерації
  циклу самі по собі.
- `env` — allowlist (`PATH`, `SystemRoot`, `TEMP`, `DOTNET_ROOT` тощо),
  не весь `process.env` цього серверного процесу.
- `ARX_SANDBOX=1` (фіксовано, не залежить від вхідних аргументів
  інструмента) — файловий I/O обмежується тимчасовою текою запуску,
  мережа (`httpGet`/`httpServer`/`wsConnect` тощо) й читання змінних
  середовища (`osEnv`) повністю заборонені. Потребує ArxNode з
  підтримкою `ARX_SANDBOX` (див. [ArxLang README](https://github.com/Faneraiy14/ArxLang#пісочниця-для-ненадійного-коду));
  зі старішим бінарником прапорець просто ігнорується.
- Вивід (`stdout`/`stderr`) обрізається до 32 КБ на потік — цикл, що
  друкує мільйони рядків, не заповнить контекст відповіді.
- Тимчасова тека видаляється в `finally` завжди, навіть при таймауті.

`RunFile` в ArxNode.cs пише `Runtime Error:`/`Parse Error:` у **stdout**
(не stderr) і завершується з `exitCode=1` — це поведінка самого
ArxNode, не цього сервера; кожен інструмент явно зазначає це в описі.

## Тести

```bash
npm test
```

14 перевірок: `smoke.mjs` викликає обробники напряму (успішний запуск,
необроблений `throw`, таймаут нескінченного циклу, `gc_max_objects`,
обрізання великого виводу, стійкість до shell-метасимволів у коді,
відсутність витоку тимчасових директорій), `transport.mjs` — те саме
через РЕАЛЬНИЙ MCP-протокол (`StdioClientTransport` + `Client`), не
лише прямі виклики функцій.

## Ліцензія

MIT — Faneraiy14.
