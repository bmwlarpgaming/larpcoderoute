/**
 * mainmenu.js — Main Menu screen for the Code de la Route web app.
 * Displays stats dashboard and scrollable list of series with leaderboard.
 */
function createMainMenu(container) {
    container.innerHTML = '';
    container.className = 'screen screen-menu';

    // Build header
    const header = document.createElement('header');
    header.className = 'header-bar';
    header.innerHTML = `
        <div class="header-left">
            <h1 class="header-title">CODE DE LA ROUTE</h1>
            <span class="header-tagline">Entraînement type 'La Poste'</span>
        </div>
        <div class="header-spacer"></div>
        <nav class="header-actions" aria-label="Navigation principale">
            <a class="header-link" href="methode.html">La méthode</a>
        </nav>
    `;
    container.appendChild(header);

    // Loading indicator
    const loader = document.createElement('div');
    loader.className = 'loading-container';
    loader.innerHTML = `<div class="loading-spinner"></div><p class="loading-label text-muted">Chargement des séries...</p>`;
    container.appendChild(loader);

    // Load and render series
    Database.listSeries().then(seriesList => {
        loader.remove();

        // Stats Dashboard
        const statsSection = createStatsDashboard(seriesList);
        container.appendChild(statsSection);

        // Scrollable series list
        const scrollable = document.createElement('div');
        scrollable.className = 'series-list scrollable';

        if (seriesList.length === 0) {
            scrollable.innerHTML = `<p class="empty-message">Aucune série trouvée dans le dossier assets.</p>`;
        } else {
            for (const series of seriesList) {
                scrollable.appendChild(createSeriesCard(series));
            }
        }

        container.appendChild(scrollable);
    }).catch(err => {
        loader.replaceChildren();
        const errorMessage = document.createElement('p');
        errorMessage.className = 'text-danger';
        errorMessage.textContent = `Erreur de chargement : ${err.message}`;
        loader.appendChild(errorMessage);
        console.error(err);
    });
}

function createStatsDashboard(seriesList) {
    const totalSeries = seriesList.length;
    const completedSeries = seriesList.filter(s => s.bestScore !== null).length;

    const bestScoresInfo = seriesList
        .filter(s => s.bestScore !== null)
        .map(s => ({ score: s.bestScore, total: s.questionsCount }));

    let avgScoreStr = '--/40';
    if (bestScoresInfo.length > 0) {
        const percentages = bestScoresInfo.map(s => s.score / s.total);
        const avgPercentage = percentages.reduce((a, b) => a + b, 0) / percentages.length;
        const avgScaled = avgPercentage * 40;
        avgScoreStr = `${avgScaled.toFixed(1)}/40`;
    }

    const passedCount = bestScoresInfo.filter(s => Database.isPassing(s.score, s.total)).length;

    const hasPassingAverage = bestScoresInfo.length > 0 &&
        (bestScoresInfo.reduce((sum, s) => sum + s.score / s.total, 0) / bestScoresInfo.length) >= 0.875;

    const dashboard = document.createElement('div');
    dashboard.className = 'stats-dashboard';
    dashboard.innerHTML = `
        <div class="stat-item">
            <span class="stat-label">Séries disponibles</span>
            <span class="stat-value">${totalSeries}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Séries complétées</span>
            <span class="stat-value stat-value--accent">${completedSeries}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Moyenne générale</span>
            <span class="stat-value${hasPassingAverage ? ' stat-value--success' : ''}">${avgScoreStr}</span>
        </div>
        <div class="stat-item">
            <span class="stat-label">Examens réussis</span>
            <span class="stat-value stat-value--success">${completedSeries > 0 ? `${passedCount} / ${completedSeries}` : '0'}</span>
        </div>
    `;
    return dashboard;
}

function createSeriesCard(series) {
    const card = document.createElement('article');
    card.className = 'series-card';

    // Score display
    let scoreHTML = '';
    if (series.bestScore !== null) {
        const passing = Database.isPassing(series.bestScore, series.questionsCount);
        const percentage = series.bestScore / series.questionsCount;
        let scoreClass = 'score-poor';
        if (passing) {
            scoreClass = percentage >= 0.95 ? 'score-excellent' : 'score-good';
        } else if (percentage >= 0.5) {
            scoreClass = 'score-average';
        }
        scoreHTML = `
            <div class="series-score">
                <span class="series-score-label">Meilleur score</span>
                <span class="series-score-value ${scoreClass}">${series.bestScore} / ${series.questionsCount}</span>
            </div>
        `;
    } else {
        scoreHTML = `
            <div class="series-score">
                <span class="series-score-label">Meilleur score</span>
                <span class="series-score-value score-none">--</span>
            </div>
        `;
    }

    card.innerHTML = `
        <div class="series-info">
            <h3 class="series-name">${series.name}</h3>
            <span class="series-meta">${series.questionsCount} questions</span>
            <p class="series-card-error" role="alert"></p>
        </div>
        ${scoreHTML}
        <div class="series-actions">
            <button type="button" class="pill-btn pill-btn--dark" data-action="learn">Entraînement</button>
            <button type="button" class="pill-btn pill-btn--accent" data-action="exam">Examen</button>
        </div>
    `;

    // Event listeners for buttons
    const learnBtn = card.querySelector('[data-action="learn"]');
    const examBtn = card.querySelector('[data-action="exam"]');
    const errorMessage = card.querySelector('.series-card-error');

    const setLoading = (loading, examMode = false) => {
        learnBtn.disabled = loading;
        examBtn.disabled = loading;
        learnBtn.textContent = loading && !examMode ? 'Chargement...' : 'Entraînement';
        examBtn.textContent = loading && examMode ? 'Chargement...' : 'Examen';
    };

    const startSeries = async (examMode) => {
        errorMessage.textContent = '';
        setLoading(true, examMode);

        try {
            const questions = await Database.loadQuestions(series.path, series.questions);
            if (!questions || questions.length === 0) {
                throw new Error('Aucune question valide n’a pu être chargée.');
            }

            const shuffled = Database.shuffleArray(questions);
            App.startQuiz({ name: series.name, questions: shuffled }, examMode);
        } catch (err) {
            console.error('Error loading series:', err);
            errorMessage.textContent = 'Impossible de charger cette série. Réessaie dans un instant.';
            setLoading(false);
        }
    };

    learnBtn.addEventListener('click', () => startSeries(false));
    examBtn.addEventListener('click', () => startSeries(true));

    return card;
}
