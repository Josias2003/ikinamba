# 6. AI/ML Subsystem

This is the most original technical contribution in the build and deserves its own
subsection under Chapter 4 "Technologies Used" — it's not a third-party API call, it's a
small ML pipeline written from scratch plus a separate, optional local-LLM integration.
The two are independent: if the LLM (Ollama) is offline, churn/maintenance scoring still
works; if scoring hasn't been trained yet, the chatbot/narrative still work.

## 6.1 Two independent AI capabilities

| Capability | Technique | Files | Always available? |
|---|---|---|---|
| Customer churn-risk scoring | Hand-written logistic regression (gradient descent) | `ai/features.ts`, `ai/logisticRegression.ts`, `ai/train.ts`, `ai/scoring.ts` | Yes, once trained — no network dependency |
| Vehicle maintenance-due scoring | Same technique, different feature set/labels | same files | Yes, once trained |
| Booking/FAQ chatbot | Prompt-grounded local LLM via Ollama | `ai/chatbot.ts`, `ai/ollamaClient.ts` | No — degrades gracefully if Ollama isn't running |
| Dashboard insight narrative | Local LLM, summarizes live metrics in prose | `ai/insights.ts`, `ai/ollamaClient.ts` | No — same fallback |

## 6.2 Why a hand-written model instead of scikit-learn/TensorFlow

The dataset size for a single car-wash branch is small (hundreds to low thousands of
visits), and the prediction task (binary churn / binary maintenance-due) is a textbook
case for logistic regression. Implementing it directly in TypeScript means:

- No Python runtime or cross-language model-serving layer in a Node.js backend.
- The whole model — weights, bias, feature standardization stats — is a ~1KB JSON file,
  trivially inspectable and explainable for the thesis defense (you can show the actual
  learned weight for each feature).
- It keeps the "AI" claim honest and demonstrable: this is a real, working,
  from-first-principles implementation of supervised learning, not a wrapper around a
  library call.

## 6.3 Feature engineering (`ai/features.ts`)

| Model | Feature vector | Computed from |
|---|---|---|
| Churn | `[daysSinceLastVisit, visitsLast90Days, avgSpend, totalSpend]` | `QueueEntry` history for the customer, **as of a cutoff date** |
| Maintenance-due | `[daysSinceLastService, mileage, serviceCount]` | `MaintenanceInspection` history for the vehicle, as of a cutoff date |

If a customer/vehicle has no history at the cutoff, the function returns a sentinel
`daysSince = 9999` rather than zero — this avoids the model interpreting "no history" as
"just visited."

## 6.4 Avoiding label leakage (`ai/train.ts`)

A naive approach (label = "did this customer ever come back?") leaks the future into the
training signal. Instead, training builds a dataset of **(cutoff date, feature vector,
label)** triples:

1. For every customer with ≥2 visits, treat **every visit** as a candidate cutoff date.
2. Compute the feature vector using only data up to and including that cutoff
   (`computeChurnFeatures(customerId, cutoff)`).
3. Label = 1 ("churned") if the customer did **not** return within `CHURN_WINDOW_DAYS`
   (45 days) after the cutoff; label = 0 if they did.
4. **Censoring rule:** skip any cutoff where the 45-day window hasn't fully elapsed yet
   relative to "now" — the true outcome isn't knowable yet, so including it would inject
   noise. (`windowEnd > now` → skip.)

The maintenance-due model uses the identical pattern over `MaintenanceInspection` records
with a 30-day window and a "service needed again soon" label.

A comment in the source (`train.ts` lines 29–33) documents a real bug that was caught and
fixed here: an earlier version excluded each customer's *last* visit from the candidate
cutoffs, which silently dropped the single clearest churn signal there is — a customer
who visited once and never returned. Worth mentioning in the thesis as evidence of
iterative validation of the ML pipeline, not just "it ran without errors."

## 6.5 Training algorithm (`ai/logisticRegression.ts`)

- **Standardization:** each feature is z-scored (`(x − mean) / std`) using training-set
  statistics, which are saved into the model file so inference uses the same scale.
- **Optimization:** full-batch gradient descent, default `epochs = 2000`,
  `learningRate = 0.1`, L2 regularization `λ = 0.001` (penalizes large weights to reduce
  overfitting on a small dataset).
- **Inference:** `score = sigmoid(weights · standardized_features + bias)` → a
  probability in [0, 1].
- **Persistence:** each trained model (`churn`, `maintenance`) is serialized to
  `apps/server/src/ai/models/<name>.json` containing weights, bias, feature means/stds,
  feature names, training timestamp, and training-set size — and cached in memory after
  first load.
- **Training trigger:** `trainAllModels()` runs as part of `npm run db:seed`; can be
  re-run any time more history accumulates.

## 6.6 Serving scores (`ai/scoring.ts`)

- `recomputeCustomerInsights()` — iterates every customer, computes both feature vectors,
  scores them against the loaded models, and **upserts** a `CustomerInsight` row with:
  - `churnRisk` (raw probability)
  - `churnRiskLabel`: LOW (< 0.33), MEDIUM (< 0.66), HIGH (≥ 0.66)
  - `maintenanceDueScore` (max across the customer's vehicles)
  - Runs nightly at 02:00 via `jobs/cron.ts`, and on-demand via `POST /ai/insights/recompute`.
- `scoreSingleCustomer(customerId)` — computes a live (uncached) score for one customer,
  used by `GET /ai/insights/customer/:customerId`.
- If a model file hasn't been trained yet, scoring logs a warning and the dashboard simply
  shows no insight rather than erroring.

## 6.7 Local LLM integration (`ai/ollamaClient.ts`)

- Thin REST wrapper over [Ollama](https://ollama.ai)'s `/api/chat` endpoint, configured by
  `OLLAMA_BASE_URL` (default `http://localhost:11434`) and `OLLAMA_MODEL` (default
  `ikinamba-ai`).
- 180-second timeout (CPU-only local inference can be slow) and **never throws** — on any
  failure it returns a fallback notice string so calling routes degrade gracefully instead
  of 500ing.
- `isOllamaAvailable()` does a lightweight 3-second-timeout ping to `/api/tags`, surfaced
  to staff as an "AI online/offline" indicator on the AI Insights page.

### 6.7.1 Chatbot (`ai/chatbot.ts`)

Builds a system prompt that lists the **real, current** service catalog and bay count
pulled live from the database, explicitly instructing the model not to invent services or
prices that aren't in the catalog — i.e. retrieval-grounded prompting rather than relying
on the model's own (possibly stale or hallucinated) knowledge. Powers the public
`/api/ai/chat` endpoint and the `ChatWidget` embedded on the booking and tracking pages.

### 6.7.2 Dashboard narrative (`ai/insights.ts`)

Feeds live operational metrics (from `reports.service.ts`) into the LLM to produce a
plain-English summary for managers (e.g. highlighting unusual wait times or revenue
trends) — surfaced on the `AIInsights.tsx` page alongside the churn-risk table.

## 6.8 Suggested framing for the methodology chapter

If the methodology section needs a sentence on the AI approach: *"Customer churn and
vehicle maintenance-due prediction use a binary logistic regression classifier
implemented from first principles (no external ML library), trained via L2-regularized
batch gradient descent on standardized features derived from operational history, with an
explicit censoring rule to prevent label leakage from incomplete observation windows.
Conversational and narrative features are served by a locally-hosted open-weight LLM via
Ollama, used only for natural-language generation grounded in live operational data — not
for the predictive scoring itself."*
