# Precision and Recall module (CS6460 project)

A short self-paced module on the confusion matrix, precision, recall and the accuracy trap.

## Learner flow
1. Sign up (email, data notice, consent), or sign in to continue. Nothing is saved before consent.
2. Diagnostic: 8 questions, two per learning goal, then a calibration report.
3. 15 slides with visuals, predict-first prompts and 5 checks. Feedback depends on the arm.
4. Final quiz: 4 questions, one per goal, then a summary of before and after, feedback by arm, and the retention link.
5. Retention quiz five days later: 8 new questions, opened from a personal link on any device. A score of 6 or more earns a certificate the learner can print or save as PDF.

## Items
25 items, each used in one place only, so no learner sees a question twice.

| Use | Items |
|---|---|
| Diagnostic | 2, 13, 6, 14, 11, 15, 10, 16 |
| Checks on slides 3, 6, 9, 12, 15 | 1, 9, 4, 8, 7 |
| Final quiz | 3, 5, 12, 17 |
| Retention quiz | 18 to 25 |

## A/B design
Arm A gets explanatory feedback (why the chosen answer is wrong and the misconception behind it). Arm B sees whether the answer was right and the correct answer. The arm is assigned at random at consent. After the retention quiz, everyone sees the correct answers with explanations, since the measurement is over by then.

## Data storage
- Each save goes to the browser first, then to the Supabase `sessions` table (one row per learner, anonymous sign-in at consent, row level security).
- Sign in only works on the browser where the learner signed up.
- Time on task only counts while the page is visible.
- Retention answers go to the `retention` table through two database functions that need the learner's link code. Learners cannot read or change this table directly.

## Setup
1. Supabase SQL Editor: run `setup.sql` (done in Milestone 1), then `setup-milestone2.sql`.
2. Anonymous sign-ins must be on (done in Milestone 1).

## Sending the retention reminder
Once a day during the study:
1. Supabase SQL Editor: run `reminders.sql`. It lists everyone who finished at least five days ago and has not taken the retention quiz, with their personal link.
2. Send each person this email from your own address:

> **Subject:** Your 5-minute retention quiz is open
>
> Hi,
>
> Thank you for taking the Precision and Recall module. Your retention quiz is now open. It has eight short questions and takes about five minutes. Please answer from memory, without notes.
>
> Your personal link: LINK (copy it from the reminders.sql result)
>
> Score 6 or more to earn your certificate.
>
> Thank you,
> YOUR NAME

## Before recruiting
- Delete all test rows: `delete from public.sessions;` (this also removes their retention rows).
- Open the Supabase dashboard now and then. Free projects pause after a period of no activity.

## Files
- `index.html` page shell
- `content.js` items, slides and quiz lists (edit content here)
- `visuals.js` slide visuals, drawn in code
- `app.js` screens and flow, including the retention quiz and certificate
- `store.js` storage layer (browser plus Supabase)
- `config.js` Supabase URL and publishable key
- `setup.sql`, `setup-milestone2.sql` tables and security rules
- `reminders.sql` who is due a reminder, and a results query
- `styles.css` styles

## Run locally
`python3 -m http.server` in this folder, then open http://localhost:8000. Add `?reset` to the URL to remove every learner saved in that browser (testing only).
