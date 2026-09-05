/**
 * How NEXORA works — explains the process with real examples from the engine.
 */
import { router } from '../router.js';

export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;

  content.innerHTML = `
    <section class="how">
      <div class="container">
        <nav class="breadcrumbs">
          <a href="#/" class="breadcrumb">Home</a>
          <span class="breadcrumb-sep">/</span>
          <span class="breadcrumb-current">How It Works</span>
        </nav>

        <h1 class="how__title">How NEXORA Works</h1>
        <p class="how__lead">
          NEXORA guides an AI engineering organization through a 12-stage lifecycle.
          Each stage produces structured artifacts with evidence, and advancement
          is gated by independent verification — never by a single AI's word.
        </p>

        <div class="stages">
          <div class="stage">
            <div class="stage__number">1</div>
            <div class="stage__content">
              <h3>Discovery</h3>
              <p>Your brief is assigned to a department of independent AI workers.
                One parses the understanding, one builds the full structural inventory,
                and an independent Boss reconstructs the core from scratch to expose gaps.</p>
            </div>
          </div>
          <div class="stage">
            <div class="stage__number">2</div>
            <div class="stage__content">
              <h3>Design &amp; Blueprint</h3>
              <p>The verified understanding becomes structured pages, features, and workflows.
                Every design decision gets an AI rationale, anchored by sha256 and backed by evidence.</p>
            </div>
          </div>
          <div class="stage">
            <div class="stage__number">3</div>
            <div class="stage__content">
              <h3>Approval Gate</h3>
              <p><strong>You review and approve the blueprint.</strong> No implementation happens
                until you give the go-ahead. This is your moment of control.</p>
            </div>
          </div>
          <div class="stage">
            <div class="stage__number">4</div>
            <div class="stage__content">
              <h3>Engineering</h3>
              <p>Implementation only proceeds against the approved blueprint.
                Every component carries provenance: which model produced it, from which blueprint.</p>
            </div>
          </div>
          <div class="stage">
            <div class="stage__number">5</div>
            <div class="stage__content">
              <h3>Verification</h3>
              <p>A five-seat reasoning council independently assesses completeness and safety.
                A master audit cross-checks. Nothing is certified without evidence.</p>
            </div>
          </div>
          <div class="stage">
            <div class="stage__number">6–12</div>
            <div class="stage__content">
              <h3>Continuous Life</h3>
              <p>Acceptance testing, deployment, runtime telemetry, drift detection,
                self-healing, and a permanent engineering organization that evolves with your system.</p>
            </div>
          </div>
        </div>

        <div class="how__outro">
          <h2>Why Blueprint-First?</h2>
          <p>
            Traditional AI coding tools generate code from a prompt and call it done.
            NEXORA believes software deserves better: a disciplined process where
            <strong> understanding precedes implementation</strong>,
            <strong> independence precedes certification</strong>, and
            <strong> evidence precedes advancement</strong>.
          </p>
          <div class="how__actions">
            <button class="btn btn--primary btn--lg" id="start">
              Get Started
            </button>
            <button class="btn btn--secondary" id="back">
              Back to Home
            </button>
          </div>
        </div>
      </div>
    </section>
  `;

  document.getElementById('start')?.addEventListener('click', () => router.go('/signup'));
  document.getElementById('back')?.addEventListener('click', () => router.go('/'));

  document.body.classList.remove('main-app');
  return () => {};
}
