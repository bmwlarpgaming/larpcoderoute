/**
 * database.js — Data layer for the Code de la Route web app.
 * Handles manifest loading, question parsing, and localStorage leaderboard.
 */
const Database = (() => {
    let manifest = null;

    /**
     * Loads the manifest.json file.
     */
    async function loadManifest() {
        if (manifest) return manifest;
        const resp = await fetch('manifest.json');
        if (!resp.ok) throw new Error(`Manifest unavailable (${resp.status})`);
        manifest = await resp.json();
        manifest.series.sort((a, b) => a.name.localeCompare(b.name, 'fr', {
            numeric: true,
            sensitivity: 'base'
        }));
        return manifest;
    }

    /**
     * Returns the list of series with leaderboard info.
     */
    async function listSeries() {
        const m = await loadManifest();
        const leaderboard = getLeaderboard();

        return m.series.map(s => ({
            name: s.name,
            path: s.path,
            questionsCount: s.questionsCount,
            questions: s.questions,
            bestScore: leaderboard[s.name]?.best_score ?? null
        }));
    }

    /**
     * Loads and parses all questions for a series.
     * Enriches with absolute paths to audio/images/video.
     */
    async function loadQuestions(seriesPath, questionsMeta) {
        const questions = [];

        for (const qMeta of questionsMeta) {
            const jsonUrl = `${seriesPath}/${qMeta.dir}/${qMeta.jsonFile}`;
            try {
                const resp = await fetch(jsonUrl);
                if (!resp.ok) throw new Error(`Question unavailable (${resp.status})`);
                const qData = await resp.json();

                const qDirPath = `${seriesPath}/${qMeta.dir}`;

                // Enrich sequence with resolved paths
                const enrichedSequence = [];
                for (const step of (qData.sequence || [])) {
                    const stepCopy = { ...step };

                    // Resolve audio path
                    if (stepCopy.son) {
                        stepCopy.audioUrl = `${qDirPath}/${stepCopy.son}.mp3`;
                    }

                    // Resolve video path
                    if (stepCopy.video) {
                        stepCopy.videoUrl = `${qDirPath}/${stepCopy.video}.webm`;
                        stepCopy.posterUrl = `${qDirPath}/${stepCopy.video}.jpg`;
                    }

                    // Resolve image paths
                    stepCopy.image = (stepCopy.image || []).map(img => ({
                        ...img,
                        url: `${qDirPath}/${img.filename}.jpg`
                    }));

                    enrichedSequence.push(stepCopy);
                }

                qData.sequence = enrichedSequence;

                questions.push(qData);
            } catch (e) {
                console.error(`Error loading question ${qMeta.dir}:`, e);
            }
        }

        return questions;
    }

    /**
     * Reads leaderboard from localStorage.
     */
    function getLeaderboard() {
        try {
            const data = localStorage.getItem('codedelaroute_leaderboard');
            return data ? JSON.parse(data) : {};
        } catch {
            return {};
        }
    }

    /**
     * Saves a score to the leaderboard.
     */
    function saveScore(seriesName, score, total, mode) {
        const data = getLeaderboard();

        if (!data[seriesName]) {
            data[seriesName] = {
                best_score: 0,
                total_questions: total,
                attempts: []
            };
        }

        if (score > (data[seriesName].best_score || 0)) {
            data[seriesName].best_score = score;
        }

        data[seriesName].attempts.push({
            date: new Date().toISOString(),
            score,
            total,
            mode
        });

        try {
            localStorage.setItem('codedelaroute_leaderboard', JSON.stringify(data));
        } catch (e) {
            console.error('Error saving leaderboard:', e);
        }
    }

    /**
     * Determines if a score is passing.
     */
    function isPassing(score, total) {
        if (total >= 30) {
            return score >= (total - 5);
        }
        return score >= Math.floor(total * 0.875);
    }

    /**
     * Shuffles an array in-place (Fisher-Yates).
     */
    function shuffleArray(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    return {
        listSeries,
        loadQuestions,
        saveScore,
        isPassing,
        shuffleArray
    };
})();
