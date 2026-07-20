/**
 * app.js — App shell and screen router for the Code de la Route web app.
 * Manages screen lifecycle and global navigation.
 */
const App = (() => {
    const appContainer = document.getElementById('app');
    let currentCleanup = null;

    function clearScreen() {
        if (currentCleanup) {
            try { currentCleanup(); } catch (e) { console.error('Cleanup error:', e); }
            currentCleanup = null;
        }
        appContainer.replaceChildren();
        appContainer.className = '';
    }

    function showMainMenu() {
        clearScreen();
        createMainMenu(appContainer);
    }

    function startQuiz(seriesData, examMode = false) {
        clearScreen();
        currentCleanup = createQuizScreen(appContainer, seriesData, { examMode });
    }

    function showReview(seriesName, score, answersLog, questionsData) {
        clearScreen();
        createReviewScreen(appContainer, seriesName, score, answersLog, questionsData);
    }

    function startSingleReview(seriesName, questionsData, questionIndex, answersLog, score) {
        clearScreen();
        currentCleanup = createQuizScreen(appContainer, {
            name: seriesName,
            questions: questionsData
        }, {
            examMode: false,
            reviewMode: true,
            reviewQIndex: questionIndex,
            reviewAnswersLog: answersLog,
            reviewScore: score
        });
    }

    // Initialize app on DOM ready
    function init() {
        showMainMenu();
    }

    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        showMainMenu,
        startQuiz,
        showReview,
        startSingleReview
    };
})();
