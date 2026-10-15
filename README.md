# Precision and Recall module (CS6460 project)

A short self-paced module on the confusion matrix, precision, recall and the accuracy trap.

## What works in this build (app shell)
- Registration with email, data notice and consent box. Nothing is saved before consent.
- Random assignment to Arm A (explanatory feedback) or Arm B (correct answer only), stored with every response.
- Diagnostic (4 items, one per objective) and a calibration report.
- 15 slides with predict-first prompts and 5 checks with arm-based feedback.
- Leave and return: progress is saved, and the exit question records why the learner left.
- Time spent on each segment is recorded.
- Results string export as a backup.

## Not yet built
- Database (week of Oct 26). Progress is in browser storage for now. Swap `store.js` for Supabase or Firebase.
- Visuals (week of Nov 2). Dashed boxes mark where each visual goes.
- Summative quiz, completion summary, retention quiz, email reminder, certificate (week of Nov 9).

## Files
- `index.html` page shell
- `content.js` items and slides (edit content here)
- `app.js` screens and flow
- `store.js` storage layer
- `styles.css` styles

## Run locally
`python3 -m http.server` in this folder, then open http://localhost:8000. Add `?reset` to the URL to start over.

## Deploy to GitHub Pages
1. Push these files to the root of a GitHub repo.
2. Repo Settings > Pages > Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
3. The site appears at `https://<user>.github.io/<repo>/`.
