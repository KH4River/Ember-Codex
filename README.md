# Ember Codex

This is an Ember Codex app built mainly with [Electron](https://electronjs.org) and [Angular](https://angular.dev), with SQLite underneath. It is a character creator for the 2024 D&D ruleset that keeps everything on your own device, so there is no account and nothing to sync: a character is a file that stays where you put it. Content does not ship with the application but arrives separately as importable packs, each of which declares its own licence and attribution.

The project is under active development.

## Requirements

Since it is a NodeJS project, installing dependencies is straightforward as soon as you have NodeJS (and by extension NPM) on your machine: open the project folder and run `npm i`.

Node 22 or later is required, because `node:sqlite` has no earlier implementation and the verification harness depends on it.

| Concern | Choice |
|---|---|
| Desktop shell | Electron |
| UI | Angular, using standalone components and signals |
| Mobile shell | Capacitor |
| Database | SQLite, via `node:sqlite` on desktop and the Capacitor SQLite plugin on mobile |
| Tests | Vitest |

Exact versions are pinned in `package.json` and `package-lock.json`.

## Running it

From then on, starting the project using Electron will require running `npm run electron`, which will trigger two concurrent processes: the renderer process, where our Angular application runs on port 4200 by default, and the main process which is our Electron app wrapping around the browser, showing said Angular application.

**The compile step that runs first is not optional.** `electron/build/` is gitignored, so on a fresh clone it does not exist and `package.json` points `main` into it, which means a clone that skips the build exits with a module-not-found error on `app.js`.

It is recommended to just run `npm run serve` or `ng serve` (in case the Angular CLI is installed globally on your machine) to work directly in the Angular application, in which case http://localhost:4200 is all you need for the interface. There is no database in a browser, so anything that touches SQLite has to be checked through Electron or on a device. Running the two in separate terminals is also worth considering, because `npm run electron` uses `--kill-others` and a crash in one process takes down the other, and a stale `ng serve` already holding port 4200 will make a second one fail to bind.

| Script | What it does |
|---|---|
| `npm run electron` | Compile the main process, then serve and launch the desktop app |
| `npm run serve` | Angular dev server on port 4200 |
| `npm run build` | Production Angular build |
| `npm run build:electron` | Compile `electron/` on its own |
| `npm run generate:migrations` | Rebuild the generated migrations module, for a reason explained below |
| `npm run test` | Unit tests |
| `npm run watch` | Development build in watch mode |
| `npm run ng` | Pass anything through to the Angular CLI |
| `npm run cap:sync` | Rebuild the web app and copy it into the Android project |
| `npm run cap:add:android` | Regenerate the `android/` folder |
| `npm run cap:open:android` | Open `android/` in Android Studio |
| `npm run cap:run:android` | Build and launch on a connected device |

The `cap:*` scripts only cover the web side. The APK itself is built with Gradle, and it needs a JDK and the Android SDK installed first — see [`docs/android-setup.md`](docs/android-setup.md), which covers the whole path from a fresh clone to an app on a phone.

## Verification

Before a change is reported as done, all three of these must pass:

```
node tools/verify-migration.mjs
npm test
npm run build
```

`verify-migration.mjs` applies the schema to an in-memory database and checks that it holds up: that every table is created, that every foreign key resolves to a real table and column, and that the rules-specific shapes behave such as HP below zero, weapon masteries, ability ceilings and rest generations. It is worth reading, since it doubles as executable documentation of what this project believes.

None of those three compile `electron/`, so anything touching the main process also needs `npm run build:electron`, since a TypeScript error in `electron/app.ts` would otherwise pass every gate.

## Layout

As of writing this, all Electron logic lives within the folder `electron/`.

| Path | Holds |
|---|---|
| `angular/` | The Angular application, and `angular.json`, which is the workspace root |
| `shared/` | Platform-agnostic code imported by both shells: the schema, migrations, repositories and models |
| `electron/` | Main process only, being window, paths and IPC rather than application logic |
| `android/` | The generated Android shell |
| `docs/` | `android-setup.md`, for building and running it |
| `tools/` | Verification harnesses, which are not application code |

Because `angular.json` sits inside `angular/`, the npm scripts `cd angular` before calling `ng`, and running `ng` from the repository root fails with a confusing "not available when running the Angular CLI outside a workspace".

The `@/*` import alias maps to both `angular/src/app/*` and `shared/*`, so a component importing `@/models/Character` resolves to `shared/models/`. Reading an import gives you the consumer, never the definition.

## The database

The schema lives in `shared/db/migrations/*.sql` and is applied in order at startup, each file setting its own `PRAGMA user_version` so the runner knows how many have already been applied.

Migrations cannot be imported directly: Node cannot import a `.sql` file, and the Angular builder's `.sql` loader breaks Node builtin resolution in the test build. So `shared/db/migrations.generated.ts` is generated from them instead.

**Run `npm run generate:migrations` after editing any `.sql` file.** The verification harness fails loudly if you forget, because otherwise the application runs stale SQL while the harness tests the fresh file.

The application reaches SQLite through a single `DatabasePort` interface with two adapters, one talking to `node:sqlite` over Electron IPC on the desktop and one using the Capacitor SQLite plugin on mobile. Business SQL lives in `shared/db/repositories/` and never inside an adapter, which is what lets the same statements execute on every platform.

## Content and licensing

The application ships no rules text. Its seed data is fixed vocabulary only, such as ability, condition and damage-type names, which are facts about the game's vocabulary rather than reproduced content, and character-creation content is expected to arrive through packs.

`source.license` and `source.attribution` record what a pack declares and the credit that comes with it, and a `CHECK` constraint prevents a pack from claiming a licence without also carrying an attribution. This only records what the user said about their own file, though. Nothing verifies the claim, and the database is local to the device with no server and no upload path.

This is not legal advice, and the licensing position should be reviewed by a lawyer before any release.

## Roadmap

| Area | Where it is going |
|---|---|
| Content packs | Importing character-creation content as JSON, each pack declaring its own licence and attribution |
| Characters | Creating and saving characters, and listing the ones held on the device |
| Distribution | Packaged desktop builds, which the development workflow does not produce yet |
| Mobile | An iOS shell. The Android shell exists and builds; iOS needs macOS and Xcode to compile at all |
