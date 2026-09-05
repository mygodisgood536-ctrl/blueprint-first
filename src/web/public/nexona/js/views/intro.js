/**
 * Introduction view — a guided 14-step product story.
 * Each step explains one concept progressively with Continue / Back.
 * Independent of backend availability (no API calls).
 */
import { router } from '../router.js';

const STEPS = [
  { icon: '◆', title: 'What is NEXORA?', desc: 'NEXORA is <strong>The Blueprint AI Software Engineering Platform</strong>. It runs a governed AI engineering organization that discovers, designs, builds, and verifies your software — with evidence at every step.' },
  { icon: '⚠', title: 'The problem with ordinary AI coding', desc: 'Today\'s AI coding tools generate code from a prompt and call it done. There is no verified understanding, no independent check, no evidence, and no approval gate. The result looks right until it silently isn\'t.' },
  { icon: '▦', title: 'Blueprint-First', desc: 'NEXORA inverts the model: <strong>understanding precedes implementation</strong>. Your idea is discovered, designed, and structured into a blueprint — and nothing is built until <strong>you</strong> approve it.' },
  { icon: '◎', title: 'Discovery', desc: 'Your brief is parsed by a department of independent AI workers. One builds the structural inventory. An independent boss reconstructs the core from scratch to expose gaps. Only a verified understanding survives.' },
  { icon: '⬡', title: 'Design', desc: 'The verified understanding becomes structured pages, features, workflows, and data. Every design decision carries an AI rationale, anchored by SHA-256 and backed by evidence.' },
  { icon: '▣', title: 'Blueprint', desc: 'Design crystallizes into a blueprint: a structured, inspectable plan for your software. It is the single source of truth that all later engineering must follow.' },
  { icon: '✓', title: 'Human approval', desc: '<strong>You</strong> review and approve the blueprint before any code is written. This is your moment of control — the gate that no AI can override.' },
  { icon: '⚙', title: 'Engineering', desc: 'Implementation proceeds only against the approved blueprint. Every component carries provenance: which model produced it, from which blueprint, with which evidence.' },
  { icon: '👥', title: 'Independent verification', desc: 'A five-perspective reasoning council independently assesses completeness and safety. A master audit cross-checks. <strong>No actor certifies its own work.</strong>' },
  { icon: '🔗', title: 'Evidence and traceability', desc: 'Every artifact is traceable to its blueprint. Every decision is traceable to its evidence. Nothing advances without verifiable proof — and the proof is inspectable.' },
  { icon: '⏣', title: 'Testing and Operations', desc: 'Acceptance testing validates the system against the blueprint. Deployment is gated by evidence. Operations begin only when verification says so.' },
  { icon: '◉', title: 'Runtime', desc: 'Continuous monitoring detects drift between the running system and its blueprint. Divergence is caught early, before it becomes a failure.' },
  { icon: '↻', title: 'Continuous Engineering', desc: 'A self-healing organization reproduces and remediates issues automatically. Your software is never finished — it is continuously re-engineered against its blueprint.' },
  { icon: '◆', title: 'Why NEXORA is different', desc: '<strong>Independence.</strong> Evidence-gated advancement. Full traceability. Honest incompleteness. Confidence grounded in proof. Lifecycle awareness. Honest AI provider states. This is how software engineering should work.' },
];

export function mount(params, account) {
  const content = document.querySelector('#app-content');
  if (!content) return;

  let currentStep = 0;

  const render = () => {
    const step = STEPS[currentStep];
    const isFirst = currentStep === 0;
    const isLast = currentStep === STEPS.length - 1;
    const dots = STEPS.map((_, i) =>
      '<span class="guided-intro__progress-dot ' +
      (i === currentStep ? 'guided-intro__progress-dot--active' :
       i < currentStep ? 'guided-intro__progress-dot--done' : '') +
      '"></span>').join('');

    content.innerHTML = `
      <section class="guided-intro">
        <div class="guided-intro__container">
          ${isFirst ? '<div class="guided-intro__brand"><img src="/nexona/img/logo.svg" alt="NEXORA" /></div>' : ''}
          <div class="guided-intro__progress">${dots}</div>
          <div class="guided-intro__step">
            <div class="guided-intro__step-icon">${step.icon}</div>
            <h2 class="guided-intro__step-title">${step.title}</h2>
            <p class="guided-intro__step-desc">${step.desc}</p>
          </div>
          ${isLast ? '<div class="guided-intro__founder"><div class="guided-intro__founder-label">Founded by</div><div class="guided-intro__founder-name">Cornelius Adedeji Victor</div></div>' : ''}
          <div class="guided-intro__nav">
            ${!isFirst ? '<button class="btn btn--secondary" id="step-back">Back</button>' : '<span></span>'}
            ${isLast ? '<button class="btn btn--primary" id="step-get-started">Get Started</button>' : '<button class="btn btn--primary" id="step-continue">Continue</button>'}
            ${isLast ? '<a href="#/how" class="btn btn--text" id="step-learn-more">How It Works</a><a href="#/help" class="btn btn--text" id="step-contact">Contact</a>' : ''}
          </div>
        </div>
      </section>
    `;

    document.getElementById('step-continue')?.addEventListener('click', () => { currentStep++; render(); });
    document.getElementById('step-back')?.addEventListener('click', () => { currentStep--; render(); });
    document.getElementById('step-get-started')?.addEventListener('click', () => router.go('/signup'));
    document.getElementById('step-learn-more')?.addEventListener('click', () => router.go('/how'));
    document.getElementById('step-contact')?.addEventListener('click', () => router.go('/help'));
    document.body.classList.remove('main-app');
  };

  render();
  return () => {};
}
