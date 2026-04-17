# Designer Extension Starter: TypeScript (Alt)

Explore the [documentation](https://developers.webflow.com/designer/reference/introduction) for in-depth information about Designer Extension features and API.

## Development

```bash
pnpm dev
```

Runs the Vite dev server (port 1337) with the Webflow extension template injected. Use the URL as the "Development URL" in the Webflow Designer Apps panel.

## Deployment

```bash
pnpm build
```

Interactive build (typecheck, Vite build to `dist/`, `webflow extension bundle`, versioned zip under `bundle/`). Upload the produced `bundle.zip` for your workspace or the Marketplace.
