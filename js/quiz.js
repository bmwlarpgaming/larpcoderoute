/* =========================================================================
 *  quiz.js – French driving-test quiz screen
 *  Exports: createQuizScreen(container, seriesData, options)
 * ========================================================================= */

/**
 * Render a full quiz screen inside `container`.
 *
 * @param {HTMLElement} container  – DOM element to render into (will be emptied)
 * @param {Object}      seriesData – { name: string, questions: Array }
 * @param {Object}      options
 * @param {boolean}     options.examMode        – auto-advance, no explanation
 * @param {boolean}     options.reviewMode      – replay a single question's explanation
 * @param {number}      options.reviewQIndex    – question index in review mode
 * @param {Object}      options.reviewAnswersLog – { qIndex: "AB.." } logged answers
 * @param {number}      options.reviewScore     – score to carry back to review screen
 * @returns {Function}  cleanup – call to tear down timers, audio, video
 */
function createQuizScreen(container, seriesData, options = {}) {

  /* ── Options ─────────────────────────────────────────────────────────── */
  const examMode        = !!options.examMode;
  const reviewMode      = !!options.reviewMode;
  const reviewQIndex    = options.reviewQIndex  || 0;
  const reviewAnswersLog = options.reviewAnswersLog || {};
  const reviewScore     = options.reviewScore  || 0;

  /* ── Cleanup bookkeeping ─────────────────────────────────────────────── */
  const _timeouts  = [];
  const _intervals = [];
  let _audio       = null;
  let _video       = null;
  let _resizeObserver = null;
  let _usesWindowResizeFallback = false;

  function addTimeout(fn, ms) {
    const id = setTimeout(fn, ms);
    _timeouts.push(id);
    return id;
  }
  function addInterval(fn, ms) {
    const id = setInterval(fn, ms);
    _intervals.push(id);
    return id;
  }
  let isDestroyed = false;

  function cleanup() {
    isDestroyed = true;
    _timeouts.forEach(clearTimeout);
    _intervals.forEach(clearInterval);
    if (_audio) { _audio.pause(); _audio.src = ''; _audio = null; }
    if (_video) { _video.pause(); _video.src = ''; _video = null; }
    if (_resizeObserver) { _resizeObserver.disconnect(); _resizeObserver = null; }
    if (_usesWindowResizeFallback) {
      window.removeEventListener('resize', resizeCanvas);
      _usesWindowResizeFallback = false;
    }
  }

  function stopQuestionMediaAndTimers() {
    _timeouts.forEach(clearTimeout);
    _timeouts.length = 0;
    if (_audio) { _audio.pause(); _audio.src = ''; _audio = null; }
    if (_video) { _video.pause(); _video.remove(); _video = null; }
  }

  /* ── State ───────────────────────────────────────────────────────────── */
  const questions       = seriesData.questions;
  const totalQuestions  = questions.length;
  let   currentIndex    = reviewMode ? reviewQIndex : 0;
  let   score           = reviewMode ? reviewScore : 0;
  const answersLog      = reviewMode ? { ...reviewAnswersLog } : {};
  let   selectedAnswers = new Set();
  let   validated       = false;
  let   timerSeconds    = 30;
  let   timerInterval   = null;
  let   canSelect       = false;

  /* ── Constants ───────────────────────────────────────────────────────── */
  const LETTERS     = ['A', 'B', 'C', 'D'];
  const TIMER_TOTAL = 30;
  const BLINK_MS    = 400;

  /* ── Build DOM ───────────────────────────────────────────────────────── */
  container.innerHTML = '';
  container.className = 'screen screen-quiz';

  const root = el('div', 'quiz-root');
  container.appendChild(root);

  /* -- Top bar -- */
  const topbar = el('div', 'quiz-topbar');
  const seriesLabel   = el('span', 'quiz-topbar-series');
  seriesLabel.textContent = seriesData.name;
  const progressLabel = el('span', 'quiz-topbar-progress');
  const quitBtn       = el('button', 'quiz-topbar-quit');
  topbar.append(seriesLabel, progressLabel, quitBtn);
  root.appendChild(topbar);

  /* -- Media area -- */
  const mediaArea = el('div', 'quiz-media-area');
  const canvas    = document.createElement('canvas');
  canvas.className = 'quiz-canvas';
  canvas.setAttribute('role', 'img');
  const ctx = canvas.getContext('2d');
  mediaArea.appendChild(canvas);
  root.appendChild(mediaArea);

  /* -- Status label -- */
  const statusLabel = el('div', 'quiz-status');
  root.appendChild(statusLabel);

  /* -- Bottom panel -- */
  const bottom      = el('div', 'quiz-bottom');
  const bottomLeft  = el('div', 'quiz-bottom-left');
  const bottomRight = el('div', 'quiz-bottom-right');
  bottom.append(bottomLeft, bottomRight);
  root.appendChild(bottom);

  /* -- Right side controls -- */
  const choiceLabel = el('div', 'quiz-choice-label');
  const circlesGrid = el('div', 'quiz-circles');
  const circleBtns  = LETTERS.map(letter => {
    const btn = el('button', 'quiz-circle-btn');
    btn.textContent = letter;
    btn.dataset.letter = letter;
    circlesGrid.appendChild(btn);
    return btn;
  });

  /* Timer */
  const timerWrap = el('div', 'quiz-timer-wrap');
  const CIRCUMFERENCE = 2 * Math.PI * 28;
  timerWrap.innerHTML = `
    <svg class="quiz-timer-svg" viewBox="0 0 65 65">
      <circle class="quiz-timer-bg" cx="32.5" cy="32.5" r="28"/>
      <circle class="quiz-timer-ring" cx="32.5" cy="32.5" r="28"
        stroke-dasharray="${CIRCUMFERENCE}"
        stroke-dashoffset="0"/>
    </svg>
    <div class="quiz-timer-text">30</div>`;
  const timerRing = timerWrap.querySelector('.quiz-timer-ring');
  const timerText = timerWrap.querySelector('.quiz-timer-text');

  /* Action buttons */
  const validateBtn = el('button', 'quiz-action-btn validate');
  validateBtn.textContent = 'Valider';
  validateBtn.disabled = true;
  const nextBtn = el('button', 'quiz-action-btn next');
  nextBtn.textContent = 'Suivant';
  nextBtn.hidden = true;

  bottomRight.append(choiceLabel, circlesGrid, timerWrap, validateBtn, nextBtn);

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (tag === 'button') e.type = 'button';
    return e;
  }

  function isDoubleQuestion(propositions) {
    return propositions[0] === 'OUI' && propositions[1] === 'NON'
        && propositions[2] === 'OUI' && propositions[3] === 'NON';
  }

  /** Parse the correct answer string ("B", "AD", etc.) into a Set of letters */
  function parseCorrect(str) {
    return new Set(str.split(''));
  }

  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }

  /* ── Load an image as a promise ──────────────────────────────────────── */
  function loadImg(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => resolve(null); // graceful fail
      img.src = src;
    });
  }

  /* ── Canvas drawing ──────────────────────────────────────────────────── */
  let _loadedImages = {};    // filename -> HTMLImageElement
  let _currentBg    = null;  // currently drawn background image
  let _currentOverlay = null;
  let _overlayMeta  = null;  // { x, y }
  let _blinkInterval = null;
  let _blinkVisible  = true;
  let _canvasWidth   = 0;
  let _canvasHeight  = 0;

  function clearCanvas() {
    if (_canvasWidth === 0 || _canvasHeight === 0) return;
    ctx.fillStyle = '#0B0B0C';
    ctx.fillRect(0, 0, _canvasWidth, _canvasHeight);
  }

  function drawBackground(img) {
    if (!img || _canvasWidth === 0 || _canvasHeight === 0) return;
    _currentBg = img;
    clearCanvas();
    const sourceWidth = img.naturalWidth || img.width;
    const sourceHeight = img.naturalHeight || img.height;
    const scale = Math.min(_canvasWidth / sourceWidth, _canvasHeight / sourceHeight);
    const w = sourceWidth * scale;
    const h = sourceHeight * scale;
    const x = (_canvasWidth - w) / 2;
    const y = (_canvasHeight - h) / 2;
    ctx.drawImage(img, x, y, w, h);
  }

  function drawOverlay(img, ox, oy) {
    if (!img || !_currentBg) return;
    // Overlay coordinates are expressed in the background image's source space.
    const bgWidth = _currentBg.naturalWidth || _currentBg.width;
    const bgHeight = _currentBg.naturalHeight || _currentBg.height;
    const overlayWidth = img.naturalWidth || img.width;
    const overlayHeight = img.naturalHeight || img.height;
    const bgScale = Math.min(_canvasWidth / bgWidth, _canvasHeight / bgHeight);
    const bgOffX  = (_canvasWidth - bgWidth * bgScale) / 2;
    const bgOffY  = (_canvasHeight - bgHeight * bgScale) / 2;
    const w = overlayWidth * bgScale;
    const h = overlayHeight * bgScale;
    const dx = bgOffX + ox * bgScale;
    const dy = bgOffY + oy * bgScale;
    ctx.drawImage(img, dx, dy, w, h);
  }

  function redraw() {
    if (_currentBg) drawBackground(_currentBg);
    if (_currentOverlay && _overlayMeta && _blinkVisible) {
      drawOverlay(_currentOverlay, _overlayMeta.x, _overlayMeta.y);
    }
  }

  function stopBlink() {
    if (_blinkInterval) { clearInterval(_blinkInterval); _blinkInterval = null; }
    _blinkVisible = true;
  }

  /** Show a specific etape image. `imgDef` comes from sequence.image[idx-1] */
  function showImage(imgDef, effet) {
    const img = _loadedImages[imgDef.filename];
    if (!img) return;

    stopBlink();

    if (imgDef.x === 0 && imgDef.y === 0) {
      // Full background
      _currentOverlay = null;
      _overlayMeta = null;
      drawBackground(img);
    } else {
      // Overlay
      _currentOverlay = img;
      _overlayMeta = { x: imgDef.x, y: imgDef.y };
      redraw();
    }

    if (effet === 'B') {
      _blinkVisible = true;
      _blinkInterval = addInterval(() => {
        _blinkVisible = !_blinkVisible;
        redraw();
      }, BLINK_MS);
    }
  }

  function showFirstImage(seq) {
    if (!seq.image || seq.image.length === 0) return;
    const firstImgDef = seq.image[0];
    const firstEffect = seq.etape?.[0]?.effet || 'C';
    showImage(firstImgDef, firstEffect);
  }

  /* ── Timer ───────────────────────────────────────────────────────────── */
  function resetTimer() {
    timerSeconds = TIMER_TOTAL;
    updateTimerDisplay();
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  function startTimer() {
    resetTimer();
    timerInterval = addInterval(() => {
      timerSeconds--;
      if (timerSeconds <= 0) {
        timerSeconds = 0;
        updateTimerDisplay();
        clearInterval(timerInterval);
        timerInterval = null;
        doValidate();
      } else {
        updateTimerDisplay();
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  function updateTimerDisplay() {
    const pct = timerSeconds / TIMER_TOTAL;
    const offset = CIRCUMFERENCE * (1 - pct);
    timerRing.style.strokeDashoffset = offset;

    let color;
    if (pct > 0.5) color = '#2ECC71';
    else if (pct > 0.2) color = '#F1C40F';
    else color = '#E74C3C';
    timerRing.style.stroke = color;

    timerText.textContent = timerSeconds;
  }

  /* ── Circle buttons ──────────────────────────────────────────────────── */
  function updateCircleStates(question) {
    const props = question.proposition;
    circleBtns.forEach((btn, i) => {
      const letter = LETTERS[i];
      btn.className = 'quiz-circle-btn';
      const propText = (props[i] || '').trim();
      btn.disabled = !propText;
      btn.setAttribute('aria-pressed', selectedAnswers.has(letter) ? 'true' : 'false');
      if (!propText) {
        btn.classList.add('disabled');
      }
      if (selectedAnswers.has(letter)) {
        btn.classList.add('selected');
      }
    });
  }

  function showResults(question) {
    const correctSet = parseCorrect(question.reponse);
    circleBtns.forEach((btn, i) => {
      const letter = LETTERS[i];
      const propText = (question.proposition[i] || '').trim();
      btn.disabled = true;
      if (!propText) return;

      btn.className = 'quiz-circle-btn';
      btn.setAttribute('aria-pressed', selectedAnswers.has(letter) ? 'true' : 'false');
      if (correctSet.has(letter)) {
        btn.classList.add('correct');
      } else if (selectedAnswers.has(letter)) {
        btn.classList.add('incorrect');
      }
    });
  }

  /* ── Build question text (left panel) ────────────────────────────────── */
  function renderQuestionText(question) {
    bottomLeft.innerHTML = '';
    const props = question.proposition;
    const enonce = question.enonce;

    if (isDoubleQuestion(props)) {
      // Double question layout
      const hasIntro = enonce[1] && enonce[1].trim() !== '';

      if (hasIntro) {
        const intro = el('p', 'quiz-enonce-intro');
        intro.textContent = enonce[0];
        bottomLeft.appendChild(intro);
      }

      // Sub-question 1
      const sq1 = el('div', 'quiz-sub-question');
      const sq1Label = el('p', 'quiz-sub-question-label');
      sq1Label.textContent = hasIntro ? enonce[1] : enonce[0];
      sq1.appendChild(sq1Label);
      const propA = el('div', 'quiz-prop');
      propA.innerHTML = `<span class="quiz-prop-letter">A</span> OUI`;
      const propB = el('div', 'quiz-prop');
      propB.innerHTML = `<span class="quiz-prop-letter">B</span> NON`;
      sq1.append(propA, propB);
      bottomLeft.appendChild(sq1);

      // Sub-question 2
      if (enonce[2] && enonce[2].trim() !== '') {
        const sq2 = el('div', 'quiz-sub-question');
        const sq2Label = el('p', 'quiz-sub-question-label');
        sq2Label.textContent = enonce[2];
        sq2.appendChild(sq2Label);
        const propC = el('div', 'quiz-prop');
        propC.innerHTML = `<span class="quiz-prop-letter">C</span> OUI`;
        const propD = el('div', 'quiz-prop');
        propD.innerHTML = `<span class="quiz-prop-letter">D</span> NON`;
        sq2.append(propC, propD);
        bottomLeft.appendChild(sq2);
      }

      choiceLabel.textContent = 'CHOIX MULTIPLE';
      choiceLabel.className = 'quiz-choice-label quiz-choice-label--multiple';
    } else {
      // Standard question
      const enonceP = el('p', 'quiz-enonce');
      enonceP.textContent = enonce[0] || '';
      bottomLeft.appendChild(enonceP);

      props.forEach((prop, i) => {
        const text = (prop || '').trim();
        if (!text) return;
        const d = el('div', 'quiz-prop');
        d.innerHTML = `<span class="quiz-prop-letter">${LETTERS[i]}</span> ${escHtml(text)}`;
        bottomLeft.appendChild(d);
      });

      const correctAns = question.reponse || '';
      if (correctAns.length > 1) {
        choiceLabel.textContent = 'CHOIX MULTIPLE';
        choiceLabel.className = 'quiz-choice-label quiz-choice-label--multiple';
      } else {
        choiceLabel.textContent = 'CHOIX UNIQUE';
        choiceLabel.className = 'quiz-choice-label quiz-choice-label--single';
      }
    }
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── Audio playback ──────────────────────────────────────────────────── */
  function playAudio(src) {
    return new Promise((resolve) => {
      if (_audio) { _audio.pause(); _audio.src = ''; }
      _audio = new Audio(src);
      _audio.addEventListener('ended', resolve, { once: true });
      _audio.addEventListener('error', resolve, { once: true }); // graceful
      _audio.play().catch(() => resolve());
    });
  }

  /* ── Schedule etapes (image transitions during audio) ────────────────── */
  function scheduleEtapes(seq, startIndex = 0) {
    const images = seq.image || [];
    const etapes = (seq.etape || []).slice(startIndex);

    etapes.forEach(step => {
      const imgIdx = step.image - 1; // 1-indexed → 0-indexed
      if (imgIdx < 0 || imgIdx >= images.length) return;
      const imgDef = images[imgIdx];
      addTimeout(() => {
        showImage(imgDef, step.effet);
      }, step.position);
    });
  }

  /* ── Validate answer ─────────────────────────────────────────────────── */
  function doValidate() {
    if (validated) return;
    validated = true;
    canSelect = false;
    stopTimer();
    stopQuestionMediaAndTimers(); // Stop question media and scheduled overlays

    const question   = questions[currentIndex];
    const correctSet = parseCorrect(question.reponse);
    const isCorrect  = setsEqual(selectedAnswers, correctSet);

    // Log answer
    answersLog[currentIndex] = Array.from(selectedAnswers).sort().join('');

    if (isCorrect) score++;

    if (examMode) {
      // Auto-advance directly without showing correct/incorrect answer highlights
      statusLabel.textContent = '';
      statusLabel.className = 'quiz-status';
      addTimeout(() => advanceQuestion(), 200);
    } else {
      // Learning mode – show explanation
      showResults(question);
      validateBtn.hidden = true;

      if (isCorrect) {
        statusLabel.textContent = '✓ Bonne réponse !';
        statusLabel.className = 'quiz-status correct';
      } else {
        const correctStr = Array.from(correctSet).sort().join(', ');
        statusLabel.textContent = `✗ Mauvaise réponse — Correct : ${correctStr}`;
        statusLabel.className = 'quiz-status incorrect';
      }

      // Play explanation
      playExplanation(question);
    }
  }

  /* ── Play explanation (learning / review mode) ───────────────────────── */
  function playExplanation(question) {
    const seq = question.sequence[1];
    if (!seq) {
      showNextButton();
      return;
    }

    stopBlink();
    showFirstImage(seq);
    scheduleEtapes(seq, 1);

    // Show next/return button immediately so the user can skip explanation narration
    showNextButton();

    playAudio(seq.audioUrl);
  }

  function showNextButton() {
    nextBtn.hidden = false;
    if (reviewMode) {
      nextBtn.textContent = 'Retour';
    } else {
      nextBtn.textContent = currentIndex < totalQuestions - 1 ? 'Suivant' : 'Voir les résultats';
    }
  }

  /* ── Advance to next question ────────────────────────────────────────── */
  function advanceQuestion() {
    if (reviewMode) {
      // Return to review screen
      App.showReview(seriesData.name, reviewScore, reviewAnswersLog, questions);
      return;
    }

    currentIndex++;
    if (currentIndex >= totalQuestions) {
      // Series complete
      const mode = examMode ? 'exam' : 'learning';
      Database.saveScore(seriesData.name, score, totalQuestions, mode);
      App.showReview(seriesData.name, score, answersLog, questions);
      return;
    }

    loadQuestion(currentIndex);
  }

  /* ── Load & start a question ─────────────────────────────────────────── */
  async function loadQuestion(index) {
    // Reset state
    selectedAnswers = new Set();
    validated       = false;
    canSelect       = true; // Enable selection immediately from the very start
    stopBlink();
    stopTimer();
    stopQuestionMediaAndTimers(); // Clear media and timeouts from previous question
    _loadedImages   = {};
    _currentBg      = null;
    _currentOverlay = null;
    _overlayMeta    = null;
    clearCanvas();

    const question = questions[index];
    const seq0 = question.sequence[0];
    canvas.setAttribute('aria-label', `Illustration de la question ${index + 1}`);

    // Update top bar
    progressLabel.textContent = `Question ${index + 1} sur ${totalQuestions}`;
    quitBtn.textContent = reviewMode ? 'Retour' : 'Quitter';

    // Reset buttons
    validateBtn.hidden = false;
    validateBtn.disabled = false;
    nextBtn.hidden = true;
    statusLabel.textContent = 'Lecture de la question...';
    statusLabel.className = 'quiz-status';

    // Render question text
    renderQuestionText(question);
    updateCircleStates(question);

    // Reset timer display
    resetTimer();

    // Preload all images for both sequences
    const allImageDefs = [];
    question.sequence.forEach(seq => {
      if (seq && seq.image) {
        seq.image.forEach(imgDef => {
          if (!allImageDefs.find(d => d.filename === imgDef.filename)) {
            allImageDefs.push(imgDef);
          }
        });
      }
    });

    const imagePromises = allImageDefs.map(async imgDef => {
      const img = await loadImg(imgDef.url);
      if (img) _loadedImages[imgDef.filename] = img;
    });
    await Promise.all(imagePromises);
    if (isDestroyed) return;

    if (reviewMode) {
      // Skip question media entirely and jump straight to explanation
      const logged = reviewAnswersLog[currentIndex] || '';
      selectedAnswers = new Set(logged.split(''));
      updateCircleStates(question);
      showResults(question);

      const correctSet = parseCorrect(question.reponse);
      const isCorrect  = setsEqual(selectedAnswers, correctSet);
      if (isCorrect) {
        statusLabel.textContent = '✓ Bonne réponse';
        statusLabel.className = 'quiz-status correct';
      } else {
        const correctStr = Array.from(correctSet).sort().join(', ');
        statusLabel.textContent = `✗ Mauvaise réponse — Correct : ${correctStr}`;
        statusLabel.className = 'quiz-status incorrect';
      }
      validated = true;
      validateBtn.hidden = true;

      playExplanation(question);
      return;
    }

    // Check for video
    const hasVideo = !!seq0.video;

    if (hasVideo) {
      // Show video first
      const video = document.createElement('video');
      video.className = 'quiz-video';
      video.src = seq0.videoUrl;
      video.poster = seq0.posterUrl;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('aria-label', `Vidéo de la question ${index + 1}`);
      _video = video;
      mediaArea.appendChild(video);

      const continueWithQuestion = () => {
        if (isDestroyed || _video !== video) return;
        video.remove();
        _video = null;
        startQuestionAudio(seq0);
      };

      video.addEventListener('ended', continueWithQuestion, { once: true });
      video.addEventListener('error', continueWithQuestion, { once: true });

      video.play().catch(continueWithQuestion);
    } else {
      startQuestionAudio(seq0);
    }
  }

  /* ── Start question audio + etape scheduling ─────────────────────────── */
  function startQuestionAudio(seq0) {
    showFirstImage(seq0);

    // The first step is already visible; only schedule subsequent transitions.
    scheduleEtapes(seq0, 1);

    // Play question audio
    playAudio(seq0.audioUrl).then(() => {
      if (isDestroyed) return;
      if (validated) return; // already validated (e.g. review mode jumped ahead)

      // Enable selection
      canSelect = true;
      statusLabel.textContent = 'Sélectionnez vos réponses';
      statusLabel.className = 'quiz-status';
      startTimer();
    });
  }

  /* ── Event handlers ──────────────────────────────────────────────────── */
  circleBtns.forEach((btn, i) => {
    btn.addEventListener('click', () => {
      if (!canSelect || validated) return;
      const letter = LETTERS[i];
      const question = questions[currentIndex];
      const propText = (question.proposition[i] || '').trim();
      if (!propText) return; // inactive

      if (selectedAnswers.has(letter)) {
        selectedAnswers.delete(letter);
      } else {
        selectedAnswers.add(letter);
      }

      updateCircleStates(question);
    });
  });

  validateBtn.addEventListener('click', () => {
    if (!validated) {
      doValidate();
    }
  });

  nextBtn.addEventListener('click', () => {
    stopBlink();
    advanceQuestion();
  });

  quitBtn.addEventListener('click', () => {
    if (reviewMode) {
      App.showReview(seriesData.name, reviewScore, reviewAnswersLog, questions);
    } else {
      App.showMainMenu();
    }
  });

  /* ── Keyboard support ────────────────────────────────────────────────── */
  function onKeyDown(e) {
    const key = e.key.toUpperCase();
    if (key === 'A' || key === 'B' || key === 'C' || key === 'D') {
      const idx = LETTERS.indexOf(key);
      if (idx >= 0) circleBtns[idx].click();
    }
    if (key === 'ENTER') {
      if (!nextBtn.hidden) {
        nextBtn.click();
      } else if (!validateBtn.disabled && !validateBtn.hidden) {
        validateBtn.click();
      }
    }
  }
  document.addEventListener('keydown', onKeyDown);

  /* ── Canvas resize (responsive and HiDPI) ────────────────────────────── */
  function resizeCanvas() {
    const rect = mediaArea.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const backingWidth = Math.round(width * pixelRatio);
    const backingHeight = Math.round(height * pixelRatio);

    if (
      _canvasWidth === width &&
      _canvasHeight === height &&
      canvas.width === backingWidth &&
      canvas.height === backingHeight
    ) return;

    _canvasWidth = width;
    _canvasHeight = height;
    canvas.width = backingWidth;
    canvas.height = backingHeight;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    clearCanvas();
    redraw();
  }

  if ('ResizeObserver' in window) {
    _resizeObserver = new ResizeObserver(resizeCanvas);
    _resizeObserver.observe(mediaArea);
  } else {
    _usesWindowResizeFallback = true;
    window.addEventListener('resize', resizeCanvas);
  }
  resizeCanvas();

  /* ── Start ───────────────────────────────────────────────────────────── */
  loadQuestion(currentIndex);

  /* ── Return cleanup ──────────────────────────────────────────────────── */
  return function() {
    cleanup();
    document.removeEventListener('keydown', onKeyDown);
  };
}
