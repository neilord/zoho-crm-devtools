Development-only Automation Map UI harness pages. They mount the real UI modules against the
synthetic port in `tests/fixtures/automation-map-port.ts`. Never part of the extension build.
Run `npx vite --config vite.harness.config.ts`, then open `http://localhost:5174/<page>.html`.

`automation-map.html` mounts the shell with the real board and trace canvases (add `?canvas=placeholder`
for the old stand-ins) and takes `?mode=full|teaser|loading|checking|failed|empty|large` plus
`?scale=large` for the 330-rule org (also with `mode=teaser`), `?gaps=1` for a real-org gap total and banner,
`?lens=dupes` for Deals.Stage writers that count twice unless folded per entity (open `field=Deals.Stage;scope=all`),
and `?skew=1` (with `mode=teaser`) for a lopsided fog with quiet modules. `canvas.html` mounts a canvas alone.
