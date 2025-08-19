# Uma Event Helper (Web)

## What it does

- Captures the game window (via browser screen capture).
- OCRs the event title with Tesseract.js.
- Looks up the event in a FastAPI backend and renders the options.
- Scores options (energy, stats, hints, statuses) and marks a recommendation.

---

## Project structure (recommended for Vercel)

```text
/api/index.py
/assets/events/
  ├─ support_card.json
  ├─ uma_data.json
  └─ ura_finale.json
index.html
styles.css
search.js
ocr.js
recommend.js
requirements.txt
```

### Frontend → API base

Use same-origin to avoid CORS/mixed-content issues:

```html
<script>
  window.API_BASE = "/api";
</script>
```

---

## Backend (FastAPI on Vercel)

Vercel treats `api/*.py` as serverless Python functions. Export an ASGI `app` from `api/index.py`.

---

## Frontend (static)

Serve the static files from the repo root. On Vercel this is automatic; locally you can run:

```bash
python -m http.server 5500
# then open http://localhost:5500
```

Ensure `window.API_BASE = "/api"` in your HTML/JS.
**Usage tips**

- Click **Capture Screen for OCR** and select the game window.
- Adjust **Scan Time** to balance CPU vs. responsiveness.
- If multiple options tie, no recommendation badge is shown.
- Labeled options are preferred over unlabeled duplicates.

---

## Deploying to Vercel

1. Commit the repo with the structure above (including `assets/events/*.json`).
2. Add `requirements.txt` with the Python deps.
3. (Optional) Add `vercel.json` to pin runtime/region and define routes.
4. In your HTML/JS set `window.API_BASE = "/api"`.
5. Deploy via:
   - **Vercel Dashboard**: “Import Project” from GitHub, or
   - **CLI**: `npm i -g vercel && vercel`
     After deploy, your API is available at `/api/...` on the same domain as the UI.

---

## Local development

- **Backend**: `uvicorn api.index:app --reload` (will serve at `http://127.0.0.1:8000`).
- **Frontend**: `python -m http.server 5500` and set `window.API_BASE="http://127.0.0.1:8000"` during local dev.

---

## License

For educational use.
