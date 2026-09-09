# UmaTools

UmaTools is a responsive Uma Musume companion suite for planning training runs, checking race requirements, exploring game data, and handling common day-to-day decisions. The tools share one navigation system, visual language, settings panel, English/Japanese localization layer, and mobile-first interface.

**Live site:** [daftuyda.moe](https://daftuyda.moe)

## The suite

| Area   | Tool                                                           | Purpose                                                                                                                          |
| ------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Site   | [About UmaTools](https://daftuyda.moe/about)                   | Learn about the project, how its tools and documentation are organized, local data and privacy, credits, and ways to contribute. |
| Rating | [Skill Optimizer](https://daftuyda.moe/optimizer)              | Build the strongest affordable skill set for Rating, Team Trials, or Aptitude Test goals.                                        |
| Rating | [Rating Calculator](https://daftuyda.moe/calculator)           | Project a final rating from stats, aptitudes, stars, unique level, and purchased skills.                                         |
| Tools  | [Event OCR](https://daftuyda.moe/events)                       | Capture an event screen, identify it, and compare its outcomes.                                                                  |
| Tools  | [Support Hint Finder](https://daftuyda.moe/hints)              | Find support cards that provide a chosen set of skill hints.                                                                     |
| Tools  | [Deck Builder](https://daftuyda.moe/deck)                      | Assemble a character and six-card support deck, inspect effects, and load scenario-aware templates.                              |
| Tools  | [Stamina Calculator](https://daftuyda.moe/stamina)             | Compare available stamina and recovery against a race-specific requirement.                                                      |
| Tools  | [Valid Accel Checker](https://daftuyda.moe/accel)              | Find acceleration skills whose activation windows fit a selected course.                                                         |
| Tools  | [Grand Live Token Planner](https://daftuyda.moe/token-planner) | Plan Grand Live songs and track the five performance-token totals still required.                                                |
| Data   | [Skill Library](https://daftuyda.moe/skills)                   | Search and filter skills by type, cost, rating value, efficiency, effects, and sources.                                          |
| Data   | [Rating Rank Breakdown](https://daftuyda.moe/rank-breakdown)   | Browse rating thresholds and jump directly to major rank families.                                                               |
| Fun    | [Randomizer](https://daftuyda.moe/random)                      | Generate characters and support decks with configurable filters.                                                                 |
| Fun    | [Umadle](https://daftuyda.moe/umadle)                          | Play the daily Uma Musume character guessing game.                                                                               |

## Shared experience

- Responsive desktop and mobile layouts with a consistent wide content shell.
- Light, dark, and OLED themes with an accessible UmaTools brand mark.
- English and Japanese interfaces plus Global/JP data filtering.
- Shared race-configuration controls, cards, dialogs, buttons, spacing, and elevation.
- Clickable skill names across the suite, opening a unit-aware skill detail dialog.
- Local saves and shareable links where a planning tool supports them.
- Service-worker caching for core pages and assets.
- Keyboard navigation, reduced-motion support, and viewport-centred dialogs.

## Repository structure

```text
UmaTools/
|-- public/                 # Complete deployable website
|   |-- assets/             # Game data, images, fonts, audio, and brand assets
|   |-- css/air.css         # Canonical shared stylesheet
|   |-- js/                 # Browser modules and page controllers
|   |-- *.html              # Public page entry points
|   |-- sw.js               # Service worker
|   `-- site.webmanifest
|-- api/                    # Vercel FastAPI functions, including social images
|-- scripts/                # Maintenance tooling grouped by purpose
|   |-- audit/              # Static-reference, browser, and Lighthouse checks
|   |-- build/              # Asset and data build steps
|   `-- data/               # GameTora, GameWith, and compatibility importers
|-- tests/
|   |-- fixtures/           # Stable test inputs
|   `-- unit/               # Versioned Node unit tests
|-- docs/
|   |-- guides/             # Maintained feature and contributor documents
|   `-- images/             # Diagrams used by the documentation
|-- .github/workflows/      # Automated data refresh
|-- package.json            # Build, sync, audit, and validation commands
`-- vercel.json             # Deployment, routes, headers, and API configuration
```

`public/` is the deployment root. Browser URLs remain `/optimizer`, `/assets/...`, `/js/...`, and so on; the repository layout does not leak into public URLs.

Vercel excludes `public/` from Python function bundles. `npm run build` runs
`build:api-assets` to copy the OG icon, font (with its license), and event JSON files
into the generated `runtime-assets/` directory. The API reads those copies when
available, and uses `public/assets/` for local development before a build. Rerun
`npm run build:api-assets` after changing source assets if staged copies exist.
`npm run test:api` tests the staged API without a `public/` directory (requires
the Python runtime dependencies and `httpx`, also used by `check:seo`).

See [Architecture](docs/architecture.md) for component ownership, data flow, and maintenance rules.

## Local development

Requirements:

- Node.js 20 or newer.
- Python 3 only for the API and Python-backed data utilities.
- The Vercel CLI for local parity with production routing and functions.

```bash
git clone https://github.com/daftuyda/UmaTools.git
cd UmaTools
npm install
npx vercel dev
```

For a static-only preview, serve the `public/` directory with any local HTTP server.

## Common commands

```bash
npm run build             # Publish documentation, validate CSS, normalize JSON, and create WebP assets
npm run build:guides      # Publish docs/guides as static documents under /guides
npm run lint              # JavaScript and Python linting
npm test                  # Rating and Team Trials tests
npm run check             # Full lint, unit, data, markup, reference, and route gate
npm run check:seo         # Verify metadata, schema, canonicals, sitemap, and internal discovery
npm run check:static      # Verify local page, asset, CSS, and service-worker references
npm run test:data         # Parse every deployed JSON dataset and manifest
npm run test:smoke        # Serve the site and verify every clean route and critical asset
npm run audit:lighthouse  # Mobile + desktop Lighthouse audit of primary tools
npm run audit:responsive  # Browser layout/runtime audit across phone, tablet, and desktop
npm run audit:ios         # Check important paths for iOS Safari compatibility
```

Set `LIGHTHOUSE_PAGES` to a comma-separated subset such as `optimizer,calculator` when iterating
locally. The audit server uses Brotli/gzip like the deployment host, while the default command still
checks every configured primary page against the performance, interactivity, and layout-shift
targets.

## Data maintenance

Runtime data lives in `public/assets/`. Game-facing URLs still begin with `/assets/`.

```bash
npm run sync:skills-all
npm run sync:uma
npm run sync:supports
npm run sync:races
npm run sync:accel-compat
npm run sync:uma-skills
npm run refresh:data
```

The scheduled workflow in `.github/workflows/gametora-scrape.yml` refreshes the core GameTora datasets. Local scrape caches are ignored and are not part of the deployable repository.

See the [data-tooling guide](scripts/data/README.md) for generator ownership, optional scraper
dependencies, and the retained browser fallback.

## Documentation

The Markdown files in `docs/guides/` are the source of truth for the public
[UmaTools documentation hub](https://daftuyda.moe/guides). Run `npm run build:guides` after editing
a document; generated HTML in `public/guides.html` and `public/guides/` should not be edited
directly.
`npm run check` verifies that the published pages and copied diagrams are current.

| Document                                                             | Covers                                                                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [Architecture](docs/architecture.md)                                 | Folder ownership, runtime boundaries, shared UI, data flow, build, deployment, and maintenance rules. |
| [Rating System](docs/guides/rating-system.md)                        | Stat scoring, skill rating, discounts, linked skills, optimization, and rank thresholds.              |
| [Team Trials](docs/guides/team-trials.md)                            | Consistency scoring, trigger analysis, expected value, and optimizer priorities.                      |
| [OCR Reference](docs/guides/ocr-guide.md)                            | Capture, preprocessing, recognition, matching, and troubleshooting.                                   |
| [Accel Checker](docs/guides/accel-checker.md)                        | Course segmentation, valid acceleration windows, uncertainty, and generated data.                     |
| [Deck Builder](docs/guides/deck-tools.md)                            | Deck construction, limit breaks, compatibility scoring, templates, hint analysis, and saved builds.   |
| [Stamina Calculator](docs/guides/stamina-calculator.md)              | Race inputs, stat adjustments, recovery math, phase modeling, and result thresholds.                  |
| [Grand Live Token Planner](docs/guides/token-planner.md)             | Song state, presets, token totals, filtering, persistence, and content maintenance.                   |
| [Local Data and Share Links](docs/guides/persistence-and-sharing.md) | Browser storage inventory, URL formats, privacy boundaries, and schema-change rules.                  |
| [Translation Reference](docs/guides/translations.md)                 | Translation modules, adding locales, interpolation, and validation.                                   |
| [Data Tooling](scripts/data/README.md)                               | Dataset ownership, sync commands, optional dependencies, and generated outputs.                       |

## Data and acknowledgements

Game data is sourced from [GameTora](https://gametora.com) and [GameWith](https://gamewith.jp). UmaTools is an independent fan project and is not affiliated with Cygames.

## License

[GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html)
