# Contributing

## Настройка окружения

Требования и шаги сборки — см. [README.md](README.md#сборка-из-исходников).

## Rust

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

## Frontend

```sh
cd crates/desktop
npm install
npx tsc --noEmit
```

## Коммиты и PR

- Один PR — одна логическая задача.
- Перед PR прогони проверки из разделов выше.
- Опиши в PR *зачем* сделано изменение, не только *что*.
- Новые строки интерфейса добавляй сразу во все файлы локализации (`crates/desktop/src/i18n/locales/`), а не только в русский или английский.
