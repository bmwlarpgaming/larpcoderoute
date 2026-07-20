/**
 * review.js — Review screen for the Code de la Route web app.
 * Shows final score and a grid of question buttons for reviewing explanations.
 */
function createReviewScreen(container, seriesName, score, answersLog, questionsData) {
    container.innerHTML = '';
    container.className = 'screen screen-review';

    const totalQuestions = questionsData.length;
    const passing = Database.isPassing(score, totalQuestions);

    const reqErrors = totalQuestions >= 30 ? 5 : totalQuestions - Math.floor(totalQuestions * 0.875);
    const badgeMsg = passing
        ? 'EXAMEN RÉUSSI ! 🎉'
        : `EXAMEN ÉCHOUÉ (${reqErrors} fautes max admises)`;

    // Build layout
    const wrapper = document.createElement('div');
    wrapper.className = 'review-container';

    // Title
    const title = document.createElement('h1');
    title.className = 'review-title';
    title.textContent = 'RÉSULTATS DE LA SÉRIE';
    wrapper.appendChild(title);

    // Score Badge
    const badge = document.createElement('div');
    badge.className = 'score-badge';
    badge.innerHTML = `
        <div class="score-badge-value">${score} / ${totalQuestions}</div>
        <div class="score-badge-label">${seriesName}</div>
        <div class="score-badge-status ${passing ? 'score-badge-status--pass' : 'score-badge-status--fail'}">${badgeMsg}</div>
    `;
    wrapper.appendChild(badge);

    // Instruction
    const instruction = document.createElement('p');
    instruction.className = 'review-instruction';
    instruction.textContent = "Cliquez sur n'importe quelle question pour revoir son explication détaillée.";
    wrapper.appendChild(instruction);

    // Questions Grid
    const gridContainer = document.createElement('div');
    gridContainer.className = 'review-grid-wrapper';

    const grid = document.createElement('div');
    grid.className = 'review-grid';

    for (let i = 0; i < questionsData.length; i++) {
        const q = questionsData[i];
        const correctAns = q.reponse || '';
        const userAns = answersLog[i] || '';
        const isCorrect = userAns === correctAns;

        const btn = document.createElement('button');
        btn.className = `review-grid-btn ${userAns === '' ? 'review-grid-btn--unanswered' : (isCorrect ? 'review-grid-btn--correct' : 'review-grid-btn--incorrect')}`;
        btn.textContent = `${i + 1}`;
        btn.title = isCorrect
            ? `Question ${i + 1} — Correct (${correctAns})`
            : `Question ${i + 1} — Incorrect (votre: ${userAns || 'aucun'}, correct: ${correctAns})`;

        const idx = i;
        btn.addEventListener('click', () => {
            App.startSingleReview(seriesName, questionsData, idx, answersLog, score);
        });

        grid.appendChild(btn);
    }

    gridContainer.appendChild(grid);
    wrapper.appendChild(gridContainer);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'review-footer';

    const menuBtn = document.createElement('button');
    menuBtn.className = 'pill-btn pill-btn--ghost';
    menuBtn.textContent = 'Menu Principal';
    menuBtn.addEventListener('click', () => App.showMainMenu());

    const restartBtn = document.createElement('button');
    restartBtn.className = 'pill-btn pill-btn--accent';
    restartBtn.textContent = 'Recommencer la série';
    restartBtn.addEventListener('click', () => {
        const shuffled = Database.shuffleArray(questionsData);
        App.startQuiz({ name: seriesName, questions: shuffled }, false);
    });

    footer.appendChild(menuBtn);
    footer.appendChild(restartBtn);
    wrapper.appendChild(footer);

    container.appendChild(wrapper);
}
