# Как написать плагин для Nodus

Плагин — это обычный объект формы `NodusPlugin` (`crates/desktop/src/plugins/types.ts`):

```ts
export type PluginTier = "isolated" | "full";

export interface NodusPlugin {
  id: string;              // стабильный, никогда не переиспользуется, напр. "acme.wordCount"
  nameKey: string;          // ключ i18n для названия в Settings → Plugins
  descriptionKey: string;   // ключ i18n для описания там же
  tier: PluginTier;         // см. "Tier" ниже
  defaultEnabled: boolean;
  onEnable: (ctx: PluginContext) => (() => void) | void;
}
```

`onEnable` вызывается при включении плагина (в том числе один раз при старте, если `defaultEnabled: true`). То, что он возвращает, вызывается при выключении — регистрируй всё через это, а не через побочный эффект на уровне модуля, иначе выключение плагина не отменит то, что он сделал.

## PluginContext — вся доступная плагину поверхность

Единственное, что плагину разрешено трогать — это `ctx`, переданный в `onEnable` (`crates/desktop/src/plugins/context.ts`):

```ts
interface PluginContext {
  registerCommand(command: Command): () => void;
  registerSidebarView(entry: SidebarViewEntry): () => void;
  registerRightPanelTab(entry: RightPanelTabEntry): () => void;
  registerNoteNameProvider(provider: () => string): () => void;

  vault: {
    listNotes(): { path: string; title: string }[];
    getOutgoingLinks(path: string): Promise<OutgoingLink[]>;
    useOutgoingLinks(path: string): OutgoingLink[];      // реактивный хук
    getAllProperties(): Promise<PropertyRow[]>;
    useAllProperties(): PropertyRow[];                    // реактивный хук
    getBookmarks(): Promise<string[]>;
    toggleBookmark(path: string): Promise<void>;
    useBookmarks(): string[];                             // реактивный хук
  };

  workspace: {
    openNote(path: string): Promise<void>;
    getActiveNotePath(): string | null;
    useActiveNotePath(): string | null;                   // реактивный хук
    useNoteContent(path: string): string;                 // живой буфер редактора
  };
}
```

Всё, что начинается на `use`, — обычный React-хук (вызывать только внутри компонента, который зарегистрирован через `registerSidebarView`/`registerRightPanelTab`). Остальное — одноразовые вызовы.

`registerCommand` добавляет пункт в палитру команд (Ctrl+P):

```ts
registerCommand({
  id: "acme.wordCount.show",
  title: "Показать количество слов",
  hotkeyLabel: "Ctrl+Shift+W", // только для отображения, саму комбинацию назначает пользователь
  run: () => { /* ... */ },
});
```

`registerSidebarView`/`registerRightPanelTab` добавляют новую вкладку в левый сайдбар / правую панель — тот же слот, что уже занимают встроенные (файлы/теги/задачи/… и outline/backlinks/history/graph соответственно):

```ts
registerSidebarView({
  id: "acme.wordCount",
  order: 25,              // встроенные используют кратные 10 — есть куда вставиться между ними
  titleKey: "plugins.wordCount.name",
  icon: MyIcon,            // ComponentType<{ size?: number }>, напр. из lucide-react
  component: WordCountPanel,
});
```

### Tier — что это и чего это не значит

`tier: "isolated"` — плагин читает/пишет данные vault'а, регистрирует команды и панели (этого хватает почти всегда). `tier: "full"` — зарезервировано для плагинов, которым нужен прямой доступ к живому инстансу CodeMirror (новые декорации, keymap'ы, источники автодополнения) — таких пока два, оба встроенные (slash-команды, режим слайдов).

Важно понимать: это соглашение для код-ревью, а не настоящая песочница. Между `isolated` и `full` нет разницы в правах на самом деле — оба выполняются в основном рендерере без изоляции (нет iframe/wasm-сэндбокса), потому что сторонних плагинов пока не от кого изолировать. Не полагайся на `tier` как на границу безопасности.

## Два способа доставки

**Встроенный** — файл прямо в `crates/desktop/src/plugins/*.ts`, зарегистрированный в `plugins/index.ts`. Так сделаны все текущие плагины (свойства заметки, исходящие ссылки, закладки, сноски, случайная заметка, уникальные имена). Требует пересборки приложения — годится только для того, что войдёт в сам Nodus.

**Внешний** — отдельно собранный `.cjs`-файл, который пользователь сам подключает через **Settings → Plugins → «Load external plugin…»**. Собирается полностью вне исходников Nodus, без единой зависимости от них — рабочий пример целиком лежит в [`examples/plugins/random-note-external/`](../examples/plugins/random-note-external/).

Загрузка работает так же, как у Obsidian с `main.js`: `read_external_file_text` (Tauri-команда) читает файл как текст, дальше он выполняется через `new Function(module, exports, require)` — никакого бандлера/сборки на стороне приложения. Плагин обязан быть простым CommonJS: `module.exports = {...}` или `module.exports.default = {...}`, без `require()` чего-либо кроме того, что ты сам заинлайнил в сборку.

### Важное ограничение внешних плагинов: почти всегда только команды, не панели

`registerSidebarView`/`registerRightPanelTab` в типе `PluginContext` есть, но для **внешнего** `.cjs`-плагина они на практике непригодны. Причина в самом загрузчике (`externalLoader.ts`): код выполняется через `new Function(module, exports, require)`, а переданный туда `require` **безусловно бросает исключение на любое имя модуля**:

```ts
const require = (name: string): never => {
  throw new Error(`External plugin "${absolutePath}" required unknown module "${name}"`);
};
```

`component: ComponentType` — это JSX, а значит скомпилированный бандл вызывает `React.createElement(...)`, для чего сборщику нужен `require("react")` (или его аналог в вашем модульном формате). Такой `require` немедленно упадёт, а глобального `window.React`, на который можно было бы сослаться в обход, приложение не выставляет. Поэтому реальный, проверенный внешний плагин (`examples/plugins/random-note-external/`) не использует JSX вообще — только `registerCommand` и одноразовые (не-`use...`) методы `ctx`.

Практический вывод: во внешнем плагине бери `registerCommand` и всё, что не начинается на `use` — `listNotes`, `openNote`, `getActiveNotePath`, `getOutgoingLinks`, `getAllProperties`, `getBookmarks`, `toggleBookmark`. Если плагину действительно нужна своя панель в сайдбаре или справа — такое пока реально только для **встроенного** плагина (файл прямо в `crates/desktop/src/plugins/`, часть общей сборки, использует настоящий `import React`) — см. `plugins/bookmarks.tsx`/`plugins/noteProperties.tsx` как пример.

### Пример — минимальный внешний плагин

`plugin.ts` (в отдельном, никак не связанном с Nodus проекте):

```ts
// Тип NodusPlugin/PluginContext скопирован вручную из
// crates/desktop/src/plugins/{types,context}.ts — не импортируется из
// приложения, оно вообще не является зависимостью этого проекта.

const wordCountPlugin = {
  id: "acme.wordCount",
  nameKey: "Word count",
  descriptionKey: "Shows the active note's word count",
  tier: "isolated",
  defaultEnabled: true,
  onEnable(ctx) {
    return ctx.registerCommand({
      id: "acme.wordCount.show",
      title: "Show word count",
      run: async () => {
        const path = ctx.workspace.getActiveNotePath();
        if (!path) return;
        const links = await ctx.vault.getOutgoingLinks(path); // пример одноразового вызова
        alert(`This note links to ${links.length} other note(s)`);
      },
    });
  },
};

module.exports = wordCountPlugin;
```

(Живой контент заметки — `useNoteContent` — это хук и одноразовым вызовом недоступен; для настоящего подсчёта слов по актуальному тексту нужна была бы панель, а значит — встроенный, а не внешний плагин, по причине выше.)

Собери в один `.cjs`-файл без внешних рантайм-зависимостей (esbuild/tsup/что угодно — см. `package.json` в примере), затем в Nodus: **Settings → Plugins → Load external plugin…** → выбрать получившийся файл. Плагин появится в списке и сразу включится.

### Текущие ограничения (не «фичи в разработке», а реальное положение дел)

- Нет собственного хранилища для настроек плагина — если он должен что-то запоминать, ему пока некуда, кроме как городить это самому поверх `localStorage`.
- Нет `unregister`/удаления внешнего плагина из списка через UI, кроме отключения тумблера.
- `PluginContext` — это всё, что есть; прямого доступа к Rust/Tauri-командам, файловой системе или сети у плагина нет и не планируется без отдельного согласования.
