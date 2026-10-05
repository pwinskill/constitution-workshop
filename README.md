# malariasimulation constitution workshop

A small web app for a 60–90 minute workshop in which the malaria modelling group
works out, together, what should and shouldn't go into the `malariasimulation`
core model. The output is the skeleton of a governance document for the package
website.

1. **Participants** judge a few hypothetical proposed changes on their own:
   CORE / EXTENSION / EXPERIMENTAL / NO, why, which factors mattered, and how
   sure they are.
2. **The facilitator** projects the results. Cases are sorted so the ones where
   people disagreed most come first, and discussion starts there.
3. During the discussion, anyone can **propose principles**. The facilitator
   sorts them into sections and opens **voting** (Agree / Amend / Disagree),
   rewording between rounds if needed.
4. At the end, **export** the adopted principles as Markdown, plus the case
   decisions and rationales for the record.

The facilitator page walks you through this as six numbered steps (Get ready →
Review → Discuss → Tidy → Vote → Finish). Each page does one thing, says what to
do, and has a **Next** button.

Nothing is summarised by an AI during the workshop. The point is for the group to
surface its own decision rules.

It's a static site (HTML, CSS, plain JavaScript, no build step), so it can be
hosted on GitHub Pages. Shared data is stored in a free
[Supabase](https://supabase.com) project. Without Supabase it runs in **demo
mode**, where everything is saved in your own browser, which is enough to try it
out.

**Step-by-step guides** are in `guides/`:

- [`guides/host-guide.html`](guides/host-guide.html): set up, check it works,
  run the session, and what to do if something goes wrong.
- [`guides/participant-guide.html`](guides/participant-guide.html): a short
  "how to join" for participants, in the room or online.

Once the site is published, they're on it too (e.g.
`…/guides/participant-guide.html`), with the workshop links filled in
automatically, so you can send participants that link. Opened from disk, the
links show as blanks; add `?url=https://<user>.github.io/<repo>/` to the
address to fill them in. To make a PDF, open a guide in Chrome or Edge and
print it (Ctrl+P → Save as PDF).

---

## Try it now (demo mode, 2 minutes)

You need any static web server. With Node (18+) installed:

```bash
node tools/serve.mjs
```

Then open:

- <http://localhost:8000/facilitator.html?demo=1>: the facilitator view,
  filled with example data.
- <http://localhost:8000/>: the participant view. Pick a name, or open
  several tabs as different people. Tabs in the same browser share demo data
  live.

`python -m http.server 8000` works too. Opening `index.html` straight from disk
doesn't, because browsers block loading the data files that way.

To clear the example data, click **⚙** (Setup) on the facilitator page, then **Clear demo data**.

---

## Preparing the workshop

### 1. Edit the content (all in `data/`)

| File | What's in it |
|---|---|
| `data/cases.json` | The hypothetical changes, deliberately ambiguous. Fifteen are written; a core set of 7 is switched on and the other 8 have `"active": false` (change it to `true` to bring one back). Each has an `id`, `title`, `summary`, and optional `upsides` / `downsides` bullets. It can also have a `suggestedPrinciple` (a rule the facilitator can reveal to get the discussion going) with a `suggestedSection`; participants never see these. Don't change an `id` once people have started answering. |
| `data/participants.json` | Optional, and empty by default: people type their own name when they join. If you'd rather they click their name in a list, add one `{ "name": "…" }` per person, with an optional `code` (used in personal links; defaults to the name) and `cases` (a fixed list of case ids). |
| `data/workshop.json` | Everything else: the title and intro text, the four decision options, the reason tags, the principle categories and their export headings, voting options, thresholds, suggested minutes per step (`schedule`), and the storage settings. |

JSON is fussy about commas and quotes. If a file is broken, the app shows an
error saying which file and roughly where.

**Assignments.** Each person gets `assignment.casesPerParticipant` cases
(6 of the 7 in the shipped settings, so everyone sees nearly the same set) when
they join, picked so that every case gets a similar number of reviewers. With 6
cases each, every case has at least 3 reviewers once 4 people have joined. As a
rule of thumb, reviewers per case ≈ people × cases each ÷ number of cases (e.g.
12 people × 6 ÷ 7 cases ≈ 10); the facilitator page shows the numbers under
**⚙ Setup → Coverage**. Each person's cases are locked when they join, so
nobody's work is reshuffled later. If you do list names in
`participants.json`, people click theirs instead of typing it, cases are planned
in advance, and anyone not on the list can still join as a guest.

**Privacy.** The names people type are stored in the database and shown on the
facilitator screen (who has joined and finished), so first names are plenty.
On GitHub Pages the data files are public, including any names you put in
`participants.json`. Answers are shown anonymously everywhere in the app and in
the exports (the full JSON backup is the exception, since it includes
participant codes).

### 2. Set up Supabase (about 15 minutes, once)

Supabase is a hosted database. The free plan is plenty for a workshop.

1. Sign in at <https://supabase.com> (a GitHub login works) and create a **new
   project**. Pick a region near you (e.g. *West EU (London)*); you won't need
   the database password again.
2. Open **SQL Editor → New query**, paste in the whole of
   [`supabase/schema.sql`](supabase/schema.sql), and press **Run**. This
   creates four tables (`participants`, `responses`, `principles`, `votes`)
   with open access for the app. It's safe to run again.
3. Click **Connect** (or go to **Project Settings → API Keys**). Copy the
   **Project URL** and the **publishable key** (it starts with
   `sb_publishable_`; older projects call it the *anon public* key). Never
   use the *secret* / *service_role* key here.
4. Put both into `data/workshop.json`:

   ```json
   "storage": {
     "supabaseUrl": "https://abcdefgh.supabase.co",
     "supabaseKey": "sb_publishable_…"
   }
   ```

5. Open the facilitator page. Step 1 should say **✓ Connected**. For a fuller
   check, click **⚙ Setup → Test connection**: every row should show a ✓.

The publishable key is meant to be public: it only allows what
`schema.sql` allows, which is reading and writing these four tables. Anyone who
finds the site could therefore also write to them, so don't collect anything
sensitive, and lock the tables afterwards (see below).

### 3. Publish on GitHub Pages

1. Put this folder in a GitHub repository and push it.
2. In the repository, go to **Settings → Pages → Build and deployment**, choose
   *Deploy from a branch*, then `main` and `/ (root)`, and save.
3. After a minute the site is live at `https://<user-or-org>.github.io/<repo>/`.
   - Participants use that address.
   - The facilitator uses `…/facilitator.html`.

GitHub Pages caches files for up to 10 minutes, so publish your final edits
well before the session.

### 4. Optional: a facilitator key

Set `"facilitatorKey": "something"` in `data/workshop.json` and the facilitator
page asks for it once per browser; `facilitator.html?key=something` also works.
It stops participants from wandering into the facilitator view and seeing
answers early. It is not real security, because the key is visible in the
public data file.

### 5. Do a dry run

Add `?ws=dry-run` to both addresses, e.g. `…/?ws=dry-run` and
`…/facilitator.html?ws=dry-run`. That gives you a separate workshop space in the
same database, so a practice run never mixes with the real thing. Ask a
couple of colleagues to join, answer a case, propose a principle and vote.

**The day before:** free Supabase projects pause after about a week without use.
Open the Supabase dashboard and restore the project if it says *paused*, then
check that step 1 of the facilitator page says **✓ Connected**.

---

## Running the session

Open `…/facilitator.html` on the laptop connected to the projector and work
through the six steps along the top. Each page tells you what to do, and the
**Next** button in the bottom-right corner moves you on. The timings below are
the suggested ones (a timer on each page, set in `schedule` in
`data/workshop.json`). They add up to about 80 minutes including the intro and
wrap-up, which leaves 10 minutes spare in an hour and a half.

| Step | What happens | Time |
|---|---|---|
| **1 Get ready** | Show the join link. People type their name and appear as they join. The card on the right says *✓ Connected* (or warns you if not). | 5 min |
| **2 Review** | Everyone answers their cases on their own laptop. You see progress only; results stay hidden so nobody is swayed. | 15 min |
| **3 Discuss** | Cases one at a time, most contested first (expect to get through the top 3–4 properly), with the split, the factors and everyone's reasons. **✚ Capture a principle** whenever the group lands on a rule. If discussion stalls, **💡 Show a suggested principle** reveals a prepared rule to test, and **Capture it** adds it (you can edit it first). The **← / →** keys move between cases. | 30 min |
| **4 Tidy** | Give each principle a section, drop duplicates and fix the wording. Participants' proposals wait under *Needs a section*. | 5 min |
| **5 Vote** | **Open voting**. Participants vote on their Principles tab and see a "Voting is open" banner. Watch the results live. **Adopt** clear winners (or use *Adopt all that reached 67%*). **Reword** ones with lots of *Amend* votes, which starts a fresh vote on the new wording. **Drop** the rest. | 20 min |
| **6 Finish** | Download the draft constitution and the workshop record. | 5 min |

Good to know:

- **Moving between steps.** You can click any step at the top, go back and
  forth, and nothing is lost. If you close the tab by accident, reopening it
  takes you back to the step you were on.
- **Hide tips** in the instruction box hides the instructions on every step
  (handy on the projector); **Show tips** brings them back.
- **A− / A+** in the top bar changes the text size for the projector; **◐**
  switches light and dark; **⚙** opens Setup (connection test, roster, personal
  links, coverage), which you shouldn't need during the session.
- *Disagreement* is the chance that two reviewers of a case, picked at random,
  chose differently: 0% means unanimous, 100% means no two agreed. A case needs
  at least 3 answers before it gets a label.
- **Voting rounds.** Rewording a principle after votes have come in starts a
  fresh vote on the new wording. The old votes are kept for the record.
  Moving a principle to another section never affects its votes.
- The line on each vote bar marks the adoption threshold (67% agree by default).
  It's advice, not automatic: you still press **Adopt**. **Undo** and
  **Restore** put things back.

If the Wi-Fi drops, participants can keep going. Answers and votes are saved on
their laptop and sent automatically when the connection returns. The badge in
the top bar shows *Live*, *Offline* or *Syncing*.

---

## After the workshop

1. **Step 6 Finish**:
   - **Download the constitution** gives a Markdown file with the adopted
     principles under each heading (*Purpose, Scope, Scientific standards,
     Validation, Technical standards, Performance and complexity, Usability,
     Maintenance and ownership, Governance and decision-making*). Tick the
     options to include vote counts, or an appendix of proposals that weren't
     adopted.
   - **Workshop record**:
     - case decisions and rationales (Markdown, anonymised);
     - responses (CSV, anonymised, ready for R: `read.csv(file, encoding = "UTF-8")`);
     - principles and votes (CSV);
     - a full JSON backup.
2. Lock the database by running the commented *AFTER THE WORKSHOP* block at the
   bottom of `supabase/schema.sql`. The site then keeps working read-only.
   Alternatively, delete the Supabase project once you have the exports.

---

## Reference

### URL options

| Option | Page | Effect |
|---|---|---|
| `?p=<code>` | participant | Personal link: skips the name picker |
| `?ws=<name>` | both | Use a separate workshop space, e.g. `dry-run` |
| `?backend=local` | both | Force demo mode (this browser only), even when Supabase is configured |
| `?demo=1` | facilitator | In demo mode, fill an empty workshop with example data |
| `?key=<key>` | facilitator | Supply the facilitator key |
| `?theme=light` / `?theme=dark` | both | Force the colour theme |

### How it's built

```
index.html, facilitator.html   the two pages
css/app.css                    all styling (pastel theme; light + dark)
data/*.json                    the editable content
js/data.js                     loads and checks the data files
js/assign.js                   shares cases out between participants
js/store*.js                   storage: Supabase (REST, with an offline outbox) or this-browser demo mode
js/stats.js                    disagreement, factor and vote tallies
js/export.js                   Markdown / CSV / JSON exports
js/participant.js              participant app
js/facilitator.js              facilitator app (the six guided steps, plus Setup)
js/ui.js, js/html.js           shared UI pieces and safe HTML templating
supabase/schema.sql            database setup
tests/                         Node tests, including a mock of the Supabase API
tools/serve.mjs                tiny local web server
guides/                        host and participant guides (HTML, printable)
```

There are no dependencies. The app talks to Supabase's REST API directly with
`fetch`, and all rows are tagged with the workshop id. Chart colours were checked
for colour-blind readers, and every chart also shows its numbers as text.

Run the tests (Node 22+):

```bash
npm test
```
