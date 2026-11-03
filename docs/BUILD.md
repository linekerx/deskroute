# Сборка из исходников

Нужен **Node.js 22 LTS** — его можно скачать на https://nodejs.org (в Arch: `sudo pacman -S nodejs npm`).

```sh
git clone <адрес этого репозитория>
cd deskroute
npm install
```

Команда `npm install` скачает Electron и electron-builder (около 200 МБ).

## Запуск без сборки

```sh
npm start
```

Если ядра Xray ещё нет, программа предложит скачать его кнопкой. Можно скачать заранее командой `npm run fetch-core`.

## Windows

```sh
npm run dist:win
```

Команда скачает ядро Xray для Windows в папку `core/` и соберёт в `dist/` установщик, портативный exe и zip-архив.

## Linux

```sh
npm run dist:linux
```

На выходе в `dist/` появятся tar.gz (вместе с `install.sh`) и AppImage. Собирать нужно на Linux.

## macOS

```sh
npm run dist:mac
```

Поддержка macOS не проверялась: системный прокси работает, строгий kill switch пока нет.

## Если GitHub недоступен

Скачайте архив ядра со страницы https://github.com/XTLS/Xray-core/releases и распакуйте `xray(.exe)`, `geoip.dat`, `geosite.dat` (и `wintun.dll` для Windows) в папку `core/`. Затем вызовите сборщик напрямую:

```sh
npx electron-builder --win --x64    # или --linux --x64
```

## Тесты

```sh
npm test                                      # разбор ссылок и подписок
XRAY_BIN=/путь/к/xray npm run test:e2e        # 14 протоколов через настоящее ядро
```

## Демо интерфейса в браузере

В `dev/mock.js` лежит имитация главного процесса. Скопируйте `src/renderer` в отдельную папку, положите `mock.js` в её подпапку `js/` и замените строку `<!-- demo-mock -->` в `index.html` на `<script src="js/mock.js"></script>`. Так интерфейс можно открыть в обычном браузере без Electron.

## Выпуск релиза

Релизы собирает GitHub Actions (`.github/workflows/release.yml`). Чтобы выпустить новую версию:
1. поднимите `version` в `package.json`;
2. положите описание в `docs/release-notes/v<версия>.md`;
3. создайте и отправьте тег:
   ```sh
   git tag v1.2.0
   git push origin v1.2.0
   ```

Сборка под Windows и Linux займёт минут десять, после чего на странице релизов появятся файлы и `SHA256SUMS.txt`.
