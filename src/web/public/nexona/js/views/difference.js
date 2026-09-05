/**
 * Difference view — explains why Blueprint-First is different from normal AI tools.
 */
import { router } from '../router.js';

export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;

  content.innerHTML = `
    <section class="difference">
      <div class="container">
        <nav class="breadcrumbs">
          <a href="#/" class="breadcrumb">Home</a>
          <span class="breadcrumb-sep">/</span>
          <a href="#/how" class="breadcrumb">How It Works</a>
          <span class="breadcrumb-sep">/</span>
          <span class="breadcrumb-current">Why Blueprint-First</span>
        </nav>

        <h1>Why Blueprint-First Engineering?</h1>

        <div class="comparison">
          <div class="comparison__normal">
            <h3>Traditional AI Coding</h3>
            <ul class="comparison__list">
              <li>Idea → prompt → code</li>
              <li>No intermediate understanding</li>
              <li>No independent verification</li>
              <li>No traceability</li>
              <li>No human approval gates</li>
              <li>No evidence of correctness</li>
              <li>No drift detection</li>
              <li>No continuous improvement</li>
            </ul>
          </div>
          <div class="comparison__divider">vs.</div>
          <div class="comparison__blueprint">
            <h3>NEXORA (Blueprint-First)</h3>
            <ul class="comparison__list">
              <li>Idea → discovery → understanding → blueprint → build → verify → operate → improve</li>
              <li>Full verified understanding before any code</li>
              <li>Independent AI workers + human oversight</li>
              <li>Full traceability by artifact ID and lineage</li>
              <li>Owner approval gate before implementation</li>
              <li>Evidence log anchors every decision</li>
              <li>Runtime telemetry detects drift</li>
              <li>Self-healing organization continuously improves</li>
            </ul>
          </div>
        </div>

        <div class="difference__outro">
          <p>
            The difference is the difference between generating a response
            and engineering a system. NEXORA is for the latter.
          </p>
          <button class="btn btn--primary btn--lg" id="start">
            Get Started
          </button>
        </div>
      </div>
    </section>
  `;

  document.getElementById('start')?.addEventListener('click', () => router.go('/signup'));
  document.body.classList.remove('main-app');
  return () => {};
}
