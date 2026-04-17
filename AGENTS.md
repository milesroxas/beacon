# Webflow Designer Extension API — agent guide

This repository is a **Webflow Designer Extension**: a single-page app that runs inside an **iframe** in the Webflow Designer and talks to the canvas through the **client-side Designer API** exposed as the global `webflow` object.

Use this file together with the official docs. For a machine-readable index of Designer API pages, fetch [Webflow Designer `llms.txt`](https://developers.webflow.com/designer/llms.txt).

## Canonical documentation

| Topic | URL |
| --- | --- |
| Designer Extensions (overview) | [Designer API & Extensions](https://developers.webflow.com/data/v2.0.0-beta/docs/designer-extensions) |
| Designer API introduction | [Introduction](https://developers.webflow.com/designer/reference/introduction) |
| First extension tutorial | [Create your first Designer Extension](https://developers.webflow.com/designer/docs/getting-started-designer-extensions) |
| Config & `webflow.json` | [Configuring your Designer Extension](https://developers.webflow.com/designer/reference/app-structure) |
| Webflow CLI | [Webflow CLI Reference](https://developers.webflow.com/designer/reference/webflow-cli) |
| Error handling | [Error handling](https://developers.webflow.com/designer/reference/error-handling) |
| App modes & permissions | [App modes](https://developers.webflow.com/designer/reference/app-modes) |
| Publishing / bundling | [Publishing your app](https://developers.webflow.com/apps/docs/publishing-your-app) (see also workspace build steps in the configuring guide) |

## Mental model

- **Runtime**: Browser only. The extension does **not** run on Webflow’s servers; it runs in the Designer like user-facing JavaScript.
- **Global API**: `webflow` is provided by the host Designer. Do not assume Node.js APIs unless you add your own bundler polyfills (usually unnecessary for canvas-only tools).
- **Interaction style**: You obtain **handles** to objects (elements, styles, pages, components, etc.), then call **async** methods on them. Most operations return `Promise`s.
- **Scope (important)**: Official troubleshooting states that **Designer APIs only access content on the current page** (not other sites or pages). Plan flows around `getCurrentPage()`, `switchPage()`, and subscriptions like `currentpage` rather than assuming cross-page canvas access without navigation.
- **Hybrid apps**: To call **Webflow Data APIs** (REST/CMS/site data on servers), register a **Hybrid** app: enable both **Data Client** and **Designer Extension** in the app setup. The Designer API and Data API solve different layers (canvas vs. remote data).

## Capabilities (what the API is for)

From the product overview and API surface, extensions typically:

- **Elements**: Create, move, nest, remove; set text; custom attributes; DOM element presets; bulk structures (`elementBuilder`, WHTML-related helpers where available).
- **Styles**: List/create/remove classes; get/set/clear CSS properties; variable modes on styles.
- **Components**: Definitions, instances, variants (many variant APIs are marked Beta in docs); enter/exit component editing; open component canvas.
- **Variables**: Collections, variables, variable modes.
- **Pages & folders**: List/create; page metadata and SEO-related fields; switch page.
- **Assets**: List/create; folders; tie assets to image elements.
- **Extension UX**: `notify`, resize panel, `closeExtension`, subscribe to selection/page/breakpoint/mode events, `getSiteInfo`, snapshots, launch context for App Connections.

Exact method names and parameters are defined in **`@webflow/designer-extension-typings`** (see below) and in the per-method reference pages linked from `llms.txt`.

## Limitations and constraints

- **Iframe UI**: Fixed panel sizes unless you call **`webflow.setExtensionSize`** or set **`size`** in `webflow.json`. If the layout breaks, assume iframe constraints and CSS scoping issues first.
- **Styling**: Prefer **scoped** CSS or prefixed class names so your UI does not clash with Webflow’s Designer.
- **Permissions**: Data API calls need correct **scopes/tokens**. Designer operations may throw **`Forbidden`** when the user’s role or **app mode** disallows the action.
- **App modes**: Not every method is valid in every Designer context (e.g. localization locale, page branch, design vs. build, canvas vs. preview). Each method’s doc includes an **App Modes** matrix; wrong mode → often **`Forbidden`** (`err.cause.tag === 'Forbidden'`).
- **Expanded app modes**: You can set `"featureFlags": { "expandedAppModes": true }` in `webflow.json` to align with users launching the app in more Designer modes; handle **`Forbidden`** and optionally **`webflow.canForAppMode`** / **`subscribe('currentappmode', ...)`** proactively.
- **Publishing**: Only **workspace admins** can upload new extension bundles (team process constraint).
- **Beta APIs**: Many reference pages are labeled **Beta** in the docs index. Treat behavior and typings as more likely to change; guard with feature detection where the typings expose optional members (e.g. some helpers are optional on `SharedApi`).

## TypeScript typings

- **Package**: `@webflow/designer-extension-typings` — declares the global `webflow: WebflowApi` in `index.d.ts`.
- **Configuration**: Use `compilerOptions.typeRoots` including `./node_modules/@webflow` and `compilerOptions.types` including `designer-extension-typings` (see package README and this repo’s `tsconfig.json`).
- **Key type files in the package** (for navigation in the IDE): `api.d.ts` (`WebflowApi`, `SharedApi`, `DesignerOnlyApi`), `elements.d.ts`, `styles.d.ts`, `components.d.ts`, `variables.d.ts`, `pages.d.ts`, `assets.d.ts`, `app-modes-generated.d.ts` (`AppMode` union), `app-connections.d.ts`, `element-presets.d.ts`, `builder-element.d.ts`.
- **`AppMode` capabilities** (for `webflow.canForAppMode` / `webflow.appModes`): include `canDesign`, `canEdit`, `canCreateStyles`, `canModifyStyles`, `canManageAssets`, `canAccessCanvas`, component/style/page/variable abilities, etc. — see `app-modes-generated.d.ts` for the full generated list.

## `webflow.json` essentials

Common fields (see [configuring guide](https://developers.webflow.com/designer/reference/app-structure)):

- **`name`**: App name (required).
- **`apiVersion`**: Set **`"2"`** for Designer API v2 (strongly recommended).
- **`size`**: `"default"` | `"comfortable"` | `"large"` (and dynamic resize via API).
- **`publicDir`**: Built assets directory (this repo uses `"dist"` from Vite).
- **`featureFlags`**: e.g. `expandedAppModes`.
- **`appIntents` / `appConnections`**: For [App Intents and Connections](https://developers.webflow.com/designer/reference/app-intents-and-connections) (launching from canvas workflows).

## CLI and local development

- **Install CLI**: e.g. `npm i -g @webflow/webflow-cli` (see CLI reference).
- **Scaffold**: `webflow extension init <name> [template]` — templates include `react`, TypeScript variants; `webflow extension list` shows options.
- **Dev server**: `webflow extension serve` (commonly port **1337**). Loading `http://localhost:1337` in a normal browser tab does **not** replicate full Designer integration; test inside the Designer.
- **Designer**: Install the app on a test site → open Designer → Apps panel → **Launch development app**.
- **Build / bundle**: Vite build to `dist/` (or your `publicDir`), then `webflow extension bundle` for `bundle.zip` upload.

This repo uses **pnpm** (`packageManager` in `package.json`); align with that for installs and scripts.

## Errors

Designer API errors are structured for programmatic handling:

- **`err.cause.tag`**: Stable identifier (e.g. `Forbidden`, `ResourceMissing`, `InvalidElementPlacement`). Prefer switching on this rather than parsing `message`.
- **`err.message`**: Human-readable; wording may change over time.

Documented cause tags include: `DuplicateValue`, `Forbidden`, `InternalError`, `InvalidElementPlacement`, `InvalidRequest`, `InvalidStyle`, `InvalidStyleName`, `InvalidStyleProperty`, `InvalidStyleVariant`, `InvalidTargetElement`, `PageCreateFailed`, `ResourceCreationFailed`, `ResourceMissing`, `VariableInvalid`, and others listed in the [error handling](https://developers.webflow.com/designer/reference/error-handling) doc.

Typings also reference **`AppModeForbiddenError`** with `cause.tag === 'ModeForbidden'` for mode-related failures — handle alongside `Forbidden` as appropriate.

Use **`webflow.notify`** for user-visible feedback on failure paths.

## Subscriptions (`webflow.subscribe`)

Typed events include (see `api.d.ts`): `selectedelement`, `mediaquery`, `currentpage`, `currentcmsitem`, `currentappmode`, `pseudomode`, `selectedvariant`. Return value is an **`Unsubscribe`** function.

## Practical checklist for agents implementing features

1. Confirm the operation is valid for the **current Designer context** (page, component canvas, app mode); use **`canForAppMode`**, **`getCurrentMode`**, **`isMode`**, or subscriptions when UX depends on mode.
2. **`await`** Designer API calls; wrap in `try/catch` and branch on **`err.cause.tag`**.
3. After destructive operations, **do not** reuse stale element handles.
4. Keep UI **scoped** to the iframe; use **`setExtensionSize`** when the panel needs more space.
5. For server-side Webflow data, use the **Data API** with proper OAuth/scopes — not the Designer API alone.

## Repo-specific notes

- **`webflow.json`**: Check `name`, `apiVersion`, `size`, `publicDir`.
- **`tsconfig.json`**: `typeRoots` includes `@webflow`; global `webflow` types come from `vite-env.d.ts` and `@webflow/designer-extension-typings`.
- **Scripts**: See `package.json` for `dev`, `build`, and lint commands used in this project.

When behavior is ambiguous, prefer the official reference page for that method (from `llms.txt`) over assumptions.
