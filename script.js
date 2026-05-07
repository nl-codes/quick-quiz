/**
 * ═══════════════════════════════════════════════════════════
 * QUIZOS — script.js
 * Full-featured MCQ quiz engine (vanilla JS, no dependencies)
 * ═══════════════════════════════════════════════════════════
 *
 * ARCHITECTURE OVERVIEW
 * ─────────────────────
 * 1. State object  – single source of truth for all quiz data
 * 2. Data loading  – fetch res/data.json, optionally shuffle
 * 3. Image detection – probe images/<n>.png via Image() object
 * 4. Rendering     – question, options, navigator, HUD
 * 5. Answer logic  – practice (instant) vs exam (deferred)
 * 6. Timer         – countdown, warnings, auto-submit
 * 7. Persistence   – localStorage save/restore
 * 8. Results       – score, ring animation, review panel
 */

/* ═══════════════════════════════════════════════════════════
   STATE — single source of truth
═══════════════════════════════════════════════════════════ */
const state = {
    // Config (set at start)
    mode: "practice", // 'practice' | 'exam'
    timerDuration: 0, // seconds, 0 = no timer
    shuffleQuestions: false,
    shuffleOptions: false,

    // Data
    originalQuestions: [], // raw from JSON
    questions: [], // possibly shuffled
    optionMaps: [], // [{originalIndex, text}] per question (for shuffle tracking)

    // Progress
    current: 0, // index of current question
    answers: [], // user's selected option index (null if unanswered)
    marked: [], // boolean array for marked questions

    // Timer
    timerInterval: null,
    secondsLeft: 0,
    startTime: null, // Date.now() when quiz started
    endTime: null,

    // UI
    sidebarOpen: true,
    reviewOpen: false,
};

const STORAGE_KEY = "quizos_session";
const IMAGES_PATH = "images/";

/* ═══════════════════════════════════════════════════════════
   DOM REFERENCES
═══════════════════════════════════════════════════════════ */
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

const screens = {
    boot: $("boot-screen"),
    quiz: $("quiz-screen"),
    result: $("result-screen"),
};

/* ═══════════════════════════════════════════════════════════
   UTILITY HELPERS
═══════════════════════════════════════════════════════════ */

/** Fisher-Yates shuffle (returns new array) */
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** Zero-pad a number to at least 2 digits */
function pad2(n) {
    return String(n).padStart(2, "0");
}

/** Format seconds → MM:SS */
function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${pad2(m)}:${pad2(s)}`;
}

/** Show a specific screen, hide others */
function showScreen(name) {
    Object.entries(screens).forEach(([k, el]) => {
        el.classList.toggle("active", k === name);
    });
}

/* ═══════════════════════════════════════════════════════════
   IMAGE DETECTION
   ──────────────────────────────────────────────────────────
   We create a hidden Image object and set its src to
   images/<questionNumber>.png (1-based index).
   If onload fires → image exists, display it.
   If onerror fires → image missing, hide the wrapper.
   This avoids broken-image icons completely.
═══════════════════════════════════════════════════════════ */
function checkAndShowImage(questionIndex) {
    const wrap = $("question-image-wrap");
    const img = $("question-image");

    // Hide by default while we probe
    wrap.style.display = "none";
    img.src = "";

    // Question numbers are 1-based
    const num = questionIndex + 1;
    const src = `${IMAGES_PATH}${num}.png`;

    const probe = new Image();
    probe.onload = () => {
        // Image exists — show it
        img.src = src;
        wrap.style.display = "block";
    };
    probe.onerror = () => {
        // No image — keep hidden (no broken icon)
        wrap.style.display = "none";
    };
    probe.src = src;
}

/* ═══════════════════════════════════════════════════════════
   BOOT SCREEN — CONFIGURATION
═══════════════════════════════════════════════════════════ */

// Mode toggle
$$("#mode-toggle .toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        $$("#mode-toggle .toggle-btn").forEach((b) =>
            b.classList.remove("active"),
        );
        btn.classList.add("active");
        state.mode = btn.dataset.mode;
        $("mode-hint").textContent =
            state.mode === "practice"
                ? "Answers revealed instantly after each selection."
                : "Answers revealed only at the end of the quiz.";
    });
});

// Timer toggle
$$("#timer-toggle .toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        $$("#timer-toggle .toggle-btn").forEach((b) =>
            b.classList.remove("active"),
        );
        btn.classList.add("active");
        const t = btn.dataset.timer;
        const customInput = $("custom-time");
        if (t === "custom") {
            customInput.classList.add("visible");
            state.timerDuration = 0;
        } else {
            customInput.classList.remove("visible");
            state.timerDuration = t === "none" ? 0 : parseInt(t) * 60;
        }
    });
});

$("custom-time").addEventListener("input", (e) => {
    const val = parseInt(e.target.value);
    state.timerDuration = isNaN(val) ? 0 : val * 60;
});

// Checkboxes
$("opt-shuffle-q").addEventListener("change", (e) => {
    state.shuffleQuestions = e.target.checked;
});
$("opt-shuffle-a").addEventListener("change", (e) => {
    state.shuffleOptions = e.target.checked;
});

/* ═══════════════════════════════════════════════════════════
   DATA LOADING
   Fetches res/data.json and initializes question/answer arrays
═══════════════════════════════════════════════════════════ */
async function loadData() {
    const res = await fetch("res/data.json");
    const data = await res.json();
    state.originalQuestions = data;
    $("boot-q-count").textContent = `[${data.length} Qs]`;
    return data;
}

/** Build the questions list (with optional shuffle) and option maps */
function prepareQuestions(data) {
    // Optionally shuffle question order
    state.questions = state.shuffleQuestions
        ? shuffle(data.map((q, i) => ({ ...q, _origIdx: i })))
        : data.map((q, i) => ({ ...q, _origIdx: i }));

    // Initialize answer/marked arrays
    state.answers = new Array(state.questions.length).fill(null);
    state.marked = new Array(state.questions.length).fill(false);

    // Build option maps for each question (handles shuffled options)
    state.optionMaps = state.questions.map((q) => {
        const opts = q.options.map((text, idx) => ({
            originalIndex: idx,
            text,
        }));
        return state.shuffleOptions ? shuffle(opts) : opts;
    });
}

/* ═══════════════════════════════════════════════════════════
   PERSISTENCE — localStorage
   ──────────────────────────────────────────────────────────
   Saved object shape:
   {
     mode, timerDuration, shuffleQuestions, shuffleOptions,
     questions,       // full question array (preserves shuffle order)
     optionMaps,      // option arrangement per question
     answers,         // user selections
     marked,          // marked flags
     current,         // last viewed question index
     secondsLeft,     // remaining timer seconds
     startTime        // epoch ms when quiz started
   }
═══════════════════════════════════════════════════════════ */
function saveProgress() {
    const snapshot = {
        mode: state.mode,
        timerDuration: state.timerDuration,
        shuffleQuestions: state.shuffleQuestions,
        shuffleOptions: state.shuffleOptions,
        questions: state.questions,
        optionMaps: state.optionMaps,
        answers: state.answers,
        marked: state.marked,
        current: state.current,
        secondsLeft: state.secondsLeft,
        startTime: state.startTime,
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (e) {
        console.warn("QuizOS: localStorage save failed", e);
    }
}

function loadSavedProgress() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function clearProgress() {
    localStorage.removeItem(STORAGE_KEY);
}

function restoreFromSave(save) {
    Object.assign(state, {
        mode: save.mode,
        timerDuration: save.timerDuration,
        shuffleQuestions: save.shuffleQuestions,
        shuffleOptions: save.shuffleOptions,
        questions: save.questions,
        optionMaps: save.optionMaps,
        answers: save.answers,
        marked: save.marked,
        current: save.current,
        secondsLeft: save.secondsLeft,
        startTime: save.startTime,
    });
}

/* ═══════════════════════════════════════════════════════════
   TIMER
═══════════════════════════════════════════════════════════ */
function startTimer() {
    if (!state.timerDuration) {
        $("timer-display").textContent = "--:--";
        return;
    }
    if (state.secondsLeft <= 0) state.secondsLeft = state.timerDuration;
    updateTimerDisplay();

    state.timerInterval = setInterval(() => {
        state.secondsLeft--;
        updateTimerDisplay();
        saveProgress(); // save regularly
        if (state.secondsLeft <= 0) {
            clearInterval(state.timerInterval);
            finishQuiz(true); // time's up — auto submit
        }
    }, 1000);
}

function updateTimerDisplay() {
    const el = $("timer-display");
    el.textContent = formatTime(state.secondsLeft);
    el.className = "hud-value timer-display";
    if (state.timerDuration > 0) {
        const pct = state.secondsLeft / state.timerDuration;
        if (pct <= 0.1) el.classList.add("danger");
        else if (pct <= 0.25) el.classList.add("warning");
    }
}

function stopTimer() {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
}

/* ═══════════════════════════════════════════════════════════
   RENDERING — QUIZ SCREEN
═══════════════════════════════════════════════════════════ */

/** Render the current question and its options */
function renderQuestion() {
    const idx = state.current;
    const q = state.questions[idx];
    const map = state.optionMaps[idx]; // [{originalIndex, text}]

    // Question number badge (display original question number if shuffled)
    $("q-num").textContent = `Q${pad2(idx + 1)} / ${state.questions.length}`;

    // Question text
    $("question-text").textContent = q.question;

    // Image — use the original index to map to the correct image file
    checkAndShowImage(q._origIdx);

    // Mark button state
    const markBtn = $("btn-mark");
    markBtn.classList.toggle("active", state.marked[idx]);

    // Build options dynamically — respects any option count (1–N)
    const list = $("options-list");
    list.innerHTML = "";

    const userAnswer = state.answers[idx]; // null or shuffled-option index
    const alreadyAnswered = userAnswer !== null;

    map.forEach((opt, shuffledIdx) => {
        const btn = document.createElement("button");
        btn.className = "option-btn";
        btn.dataset.idx = shuffledIdx;

        // Key label: 1, 2, 3... (or A, B, C... style — using numbers for keyboard shortcuts)
        const key = document.createElement("span");
        key.className = "option-key";
        key.textContent = shuffledIdx + 1;

        const text = document.createElement("span");
        text.className = "option-text";
        text.textContent = opt.text;

        btn.appendChild(key);
        btn.appendChild(text);

        // Apply existing answer state for visual restoration
        if (alreadyAnswered) {
            applyAnswerStyling(btn, shuffledIdx, userAnswer, q.answer, map);
            btn.disabled = state.mode === "practice"; // lock in practice
        }

        btn.addEventListener("click", () => handleOptionClick(shuffledIdx));
        list.appendChild(btn);
    });

    // Feedback box (practice mode)
    resetFeedback();
    if (alreadyAnswered && state.mode === "practice") {
        const correctShuffledIdx = map.findIndex(
            (o) => o.originalIndex === q.answer,
        );
        showFeedback(userAnswer === correctShuffledIdx);
    }

    // Nav buttons
    $("btn-prev").disabled = idx === 0;
    $("btn-next").textContent =
        idx === state.questions.length - 1 ? "FINISH ▶" : "NEXT ▶";

    updateHUD();
    updateNavigator();

    // Animate the card
    const card = $("question-card");
    card.style.animation = "none";
    void card.offsetHeight; // reflow
    card.style.animation = "slideIn 0.25s ease";
}

/**
 * Apply visual styling classes to an option button.
 * correctOriginalIndex: from q.answer (original index)
 * map: [{originalIndex, text}]
 */
function applyAnswerStyling(
    btn,
    btnShuffledIdx,
    userShuffledIdx,
    correctOriginalIndex,
    map,
) {
    const correctShuffledIdx = map.findIndex(
        (o) => o.originalIndex === correctOriginalIndex,
    );
    const isCorrect = btnShuffledIdx === correctShuffledIdx;
    const isSelected = btnShuffledIdx === userShuffledIdx;

    if (state.mode === "practice") {
        if (isSelected && isCorrect) btn.classList.add("correct");
        else if (isSelected) btn.classList.add("incorrect");
        else if (isCorrect) btn.classList.add("correct"); // show right answer too
    } else {
        if (isSelected) btn.classList.add("selected");
    }
}

function resetFeedback() {
    const fb = $("feedback-box");
    fb.className = "feedback-box hidden";
}

function showFeedback(isCorrect) {
    const fb = $("feedback-box");
    const icon = $("feedback-icon");
    const text = $("feedback-text");

    fb.className = `feedback-box ${isCorrect ? "correct-fb" : "incorrect-fb"}`;
    icon.textContent = isCorrect ? "✔" : "✘";
    text.textContent = isCorrect
        ? "Correct!"
        : "Incorrect — correct answer highlighted above.";
}

/** Update the HUD progress bar and mode indicator */
function updateHUD() {
    const total = state.questions.length;
    const answered = state.answers.filter((a) => a !== null).length;
    const pct = total > 0 ? (answered / total) * 100 : 0;

    $("progress-bar").style.width = pct + "%";
    $("progress-text").textContent = `${answered} / ${total} answered`;
    $("hud-mode").textContent = state.mode.toUpperCase();
}

/** Rebuild the navigator grid and stats */
function updateNavigator() {
    const grid = $("nav-grid");
    grid.innerHTML = "";

    const total = state.questions.length;
    let answered = 0;
    let markedCount = 0;

    for (let i = 0; i < total; i++) {
        const btn = document.createElement("button");
        btn.className = "nav-btn";
        btn.textContent = i + 1;
        btn.title = `Question ${i + 1}`;
        btn.dataset.qi = i;

        if (i === state.current) btn.classList.add("current");
        if (state.answers[i] !== null) {
            btn.classList.add("answered");
            answered++;
        }
        if (state.marked[i]) {
            btn.classList.add("marked");
            markedCount++;
        }

        btn.addEventListener("click", () => navigateTo(i));
        grid.appendChild(btn);
    }

    // Stats
    $("stat-answered").textContent = answered;
    $("stat-marked").textContent = markedCount;
    $("stat-unanswered").textContent = total - answered;
}

/* ═══════════════════════════════════════════════════════════
   USER INTERACTIONS
═══════════════════════════════════════════════════════════ */

/** Handle option selection */
function handleOptionClick(shuffledIdx) {
    const idx = state.current;
    const q = state.questions[idx];
    const map = state.optionMaps[idx];

    // In practice mode, lock after first answer
    if (state.mode === "practice" && state.answers[idx] !== null) return;

    state.answers[idx] = shuffledIdx;
    saveProgress();

    // Update button styles
    const btns = $$(".option-btn");
    btns.forEach((btn) => {
        const bIdx = parseInt(btn.dataset.idx);
        btn.className = "option-btn"; // reset
        applyAnswerStyling(btn, bIdx, shuffledIdx, q.answer, map);
        if (state.mode === "practice") btn.disabled = true;
    });

    // Show feedback in practice mode
    if (state.mode === "practice") {
        const correctShuffledIdx = map.findIndex(
            (o) => o.originalIndex === q.answer,
        );
        showFeedback(shuffledIdx === correctShuffledIdx);
    }

    updateNavigator();
    updateHUD();
}

/** Navigate to a specific question index */
function navigateTo(idx) {
    if (idx < 0 || idx >= state.questions.length) return;
    state.current = idx;
    saveProgress();
    renderQuestion();
}

/** Previous button */
$("btn-prev").addEventListener("click", () => navigateTo(state.current - 1));

/** Next / Finish button */
$("btn-next").addEventListener("click", () => {
    if (state.current === state.questions.length - 1) {
        confirmFinish();
    } else {
        navigateTo(state.current + 1);
    }
});

/** Mark button */
$("btn-mark").addEventListener("click", () => {
    state.marked[state.current] = !state.marked[state.current];
    $("btn-mark").classList.toggle("active", state.marked[state.current]);
    updateNavigator();
    saveProgress();
});

/** Navigator toggle */
$("btn-nav-toggle").addEventListener("click", toggleSidebar);
$("sidebar-close").addEventListener("click", toggleSidebar);

function toggleSidebar() {
    state.sidebarOpen = !state.sidebarOpen;
    $("sidebar").classList.toggle("collapsed", !state.sidebarOpen);
}

/** Finish from sidebar */
$("btn-finish-sidebar").addEventListener("click", confirmFinish);

function confirmFinish() {
    const unanswered = state.answers.filter((a) => a === null).length;
    if (unanswered > 0) {
        const ok = confirm(
            `You have ${unanswered} unanswered question(s). Submit anyway?`,
        );
        if (!ok) return;
    }
    finishQuiz(false);
}

/* ═══════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS
   ──────────────────────────────────────────────────────────
   ArrowLeft / ArrowRight  → navigate questions
   1–9                     → select option by number
   M                       → toggle mark
═══════════════════════════════════════════════════════════ */
document.addEventListener("keydown", (e) => {
    if (!screens.quiz.classList.contains("active")) return;
    // Don't fire if user is in an input field
    if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;

    switch (e.key) {
        case "ArrowLeft":
            navigateTo(state.current - 1);
            break;
        case "ArrowRight":
            if (state.current === state.questions.length - 1) confirmFinish();
            else navigateTo(state.current + 1);
            break;
        case "m":
        case "M":
            $("btn-mark").click();
            break;
        default: {
            // Number keys 1–9 → select option
            const num = parseInt(e.key);
            if (!isNaN(num) && num >= 1) {
                const optBtns = $$(".option-btn");
                if (optBtns[num - 1]) optBtns[num - 1].click();
            }
        }
    }
});

/* ═══════════════════════════════════════════════════════════
   FINISH & RESULTS
═══════════════════════════════════════════════════════════ */
function finishQuiz(timedOut = false) {
    stopTimer();
    state.endTime = Date.now();
    clearProgress();
    showScreen("result");
    renderResults(timedOut);
}

function renderResults(timedOut) {
    const questions = state.questions;
    const total = questions.length;
    let correct = 0;
    let incorrect = 0;
    let skipped = 0;

    questions.forEach((q, i) => {
        const userAns = state.answers[i];
        if (userAns === null) {
            skipped++;
        } else {
            // Map shuffled answer index back to original
            const map = state.optionMaps[i];
            const origIdx = map[userAns].originalIndex;
            if (origIdx === q.answer) correct++;
            else incorrect++;
        }
    });

    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    const grade = getGrade(pct);

    // Score ring animation
    // Circumference of r=85 circle: 2π×85 ≈ 534
    const circumference = 534;
    const offset = circumference - (pct / 100) * circumference;
    setTimeout(() => {
        $("ring-fill").style.strokeDashoffset = offset;
        // Ring color based on score
        $("ring-fill").style.stroke =
            pct >= 70
                ? "var(--green)"
                : pct >= 50
                  ? "var(--yellow)"
                  : "var(--red)";
        $("ring-fill").style.filter =
            pct >= 70
                ? "drop-shadow(0 0 6px var(--green))"
                : pct >= 50
                  ? "drop-shadow(0 0 6px var(--yellow))"
                  : "drop-shadow(0 0 6px var(--red))";
    }, 100);

    $("score-pct").textContent = `${pct}%`;
    $("result-grade").textContent = timedOut ? `TIME'S UP — ${grade}` : grade;
    $("res-correct").textContent = correct;
    $("res-incorrect").textContent = incorrect;
    $("res-skipped").textContent = skipped;

    // Time taken
    if (state.startTime && state.endTime) {
        const taken = Math.floor((state.endTime - state.startTime) / 1000);
        $("res-time").textContent = formatTime(taken);
    }
}

function getGrade(pct) {
    if (pct >= 90) return "A+";
    if (pct >= 80) return "A";
    if (pct >= 70) return "B";
    if (pct >= 60) return "C";
    if (pct >= 50) return "D";
    return "F";
}

/* ── Review answers ────────────────────────────────────── */
$("btn-review").addEventListener("click", () => {
    state.reviewOpen = !state.reviewOpen;
    const panel = $("review-panel");
    if (state.reviewOpen) {
        panel.classList.remove("hidden");
        buildReview();
        $("btn-review").textContent = "HIDE REVIEW";
    } else {
        panel.classList.add("hidden");
        $("btn-review").textContent = "REVIEW ANSWERS";
    }
});

function buildReview() {
    const list = $("review-list");
    list.innerHTML = "";

    state.questions.forEach((q, i) => {
        const map = state.optionMaps[i];
        const userAns = state.answers[i]; // shuffled index or null
        const userOrigIdx =
            userAns !== null ? map[userAns].originalIndex : null;
        const isCorrect = userOrigIdx === q.answer;
        const isSkipped = userAns === null;

        const item = document.createElement("div");
        item.className = `review-item ${isSkipped ? "rev-skipped" : isCorrect ? "rev-correct" : "rev-incorrect"}`;

        const qNum = document.createElement("div");
        qNum.className = "review-q-num";
        qNum.textContent = `QUESTION ${i + 1}`;

        const qText = document.createElement("div");
        qText.className = "review-q-text";
        qText.textContent = q.question;

        const opts = document.createElement("div");
        opts.className = "review-options";

        // Show original options in original order for clarity
        q.options.forEach((optText, origIdx) => {
            const optEl = document.createElement("div");
            const isAnswer = origIdx === q.answer;
            const wasSelected = origIdx === userOrigIdx;

            optEl.className = "review-option";
            if (isAnswer) optEl.classList.add("rev-opt-correct");
            else if (wasSelected) optEl.classList.add("rev-opt-selected");
            else optEl.classList.add("rev-opt-normal");

            optEl.textContent = optText;

            const badge = document.createElement("span");
            badge.className = "rev-badge";
            if (isAnswer && wasSelected) badge.textContent = "✔ YOUR ANSWER";
            else if (isAnswer) badge.textContent = "✔ CORRECT";
            else if (wasSelected) badge.textContent = "✘ YOUR ANSWER";

            if (badge.textContent) optEl.appendChild(badge);
            opts.appendChild(optEl);
        });

        item.appendChild(qNum);
        item.appendChild(qText);
        item.appendChild(opts);
        list.appendChild(item);
    });
}

/* ── Restart ────────────────────────────────────────────── */
$("btn-restart").addEventListener("click", () => {
    clearProgress();
    location.reload();
});

/* ═══════════════════════════════════════════════════════════
   QUIZ INITIALIZATION — START FLOW
═══════════════════════════════════════════════════════════ */

/** Launch a fresh quiz session */
function startQuiz() {
    state.current = 0;
    state.startTime = Date.now();
    state.secondsLeft = state.timerDuration;
    $("hud-mode").textContent = state.mode.toUpperCase();
    showScreen("quiz");

    // Sidebar: open by default on desktop, closed on mobile
    if (window.innerWidth < 768) {
        state.sidebarOpen = false;
        $("sidebar").classList.add("collapsed");
    }

    renderQuestion();
    startTimer();
    saveProgress();
}

/** Resume a saved session */
function resumeQuiz() {
    $("hud-mode").textContent = state.mode.toUpperCase();
    showScreen("quiz");
    renderQuestion();
    startTimer();
}

/* ── Boot screen initialization ─────────────────────────── */
async function init() {
    // Load question data
    let data;
    try {
        data = await loadData();
    } catch (e) {
        $("boot-q-count").textContent = "[ERROR: data.json not found]";
        $("boot-q-count").style.color = "var(--red)";
        console.error("QuizOS: Failed to load res/data.json", e);
        return;
    }

    // Check for saved session
    const saved = loadSavedProgress();
    if (saved && saved.questions && saved.questions.length > 0) {
        $("boot-save-status").textContent = "[FOUND]";
        const banner = $("resume-banner");
        banner.classList.remove("hidden");

        $("btn-resume").addEventListener("click", () => {
            restoreFromSave(saved);
            resumeQuiz();
        });

        $("btn-new").addEventListener("click", () => {
            banner.classList.add("hidden");
            clearProgress();
        });
    } else {
        $("boot-save-status").textContent = "[NONE]";
    }

    // Start button
    $("btn-start").addEventListener("click", () => {
        prepareQuestions(data);
        startQuiz();
    });
}

// Kick off
init();
