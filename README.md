# Uma Event Helper (Web)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/daftuyda/Uma-Event-Helper-Web)

## Overview

Uma Event Helper is a browser-based tool to assist with Uma Musume event choices. It:

- Captures the game window using browser screen capture.
- Uses Tesseract.js for OCR to read event titles.
- Looks up events via a FastAPI backend.
- Scores and recommends options based on stats, energy, hints, and statuses.

---

## Usage

1. **Open the app** in your browser.
2. Click **Capture Screen for OCR** and select your game window.
3. Adjust **Scan Time** for OCR frequency (CPU vs. responsiveness).
4. Enter or OCR an event name to search.
5. The app will display event options, score them, and recommend the best choice.
   - If multiple options tie, no recommendation badge is shown.
   - Labeled options are preferred over unlabeled duplicates.

---

## Project Structure

```
/api/index.py
/assets/events/
/index.html
/styles.css
/search.js
/ocr.js
/recommend.js
/requirements.txt
/README.md
```

---

## Local Development

- **Install dependencies**  
  Make sure you have Node.js and the [Vercel CLI](https://vercel.com/download) installed:

  ```bash
   npm i -g vercel
  ```

- **Clone the repo**
  
  ```bash
  git clone https://github.com/daftuyda/Uma-Event-Helper-Web.git
  cd Uma-Event-Helper-Web
  ```

- **Run with Vercel**
  
  ```bash
  vercel dev --debug
  ```

---

## License

For educational use.
